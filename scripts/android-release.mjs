#!/usr/bin/env node
/**
 * Yealico release 交付入口：构建 → 真机安装 → 清理安装包。
 *
 * 项目规则：
 * - 只用真机验收，不安装到模拟器。
 * - 安装成功后立即删除 android/app/build/outputs/apk 下的 APK。
 * - 构建或安装失败时保留 APK，便于排查；清理只发生在安装成功之后。
 *
 * 用法：
 *   npm run android:release              # 构建 release、安装到唯一就绪真机、删除 APK
 *   npm run android:release -- --serial <序列号>
 *   npm run apk:clean                    # 只清理构建目录里遗留的 APK
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const apkRoot = path.join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    cwd: options.cwd ?? repoRoot,
    env: process.env,
  });
  if (result.error) {
    fail(`无法执行 ${command}: ${result.error.message}`);
  }
  return result.status ?? 1;
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    cwd: repoRoot,
    env: process.env,
  });
  if (result.error) {
    return { status: 1, stdout: '', stderr: result.error.message };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function readLocalSdkDir() {
  const file = path.join(repoRoot, 'android', 'local.properties');
  if (!existsSync(file)) {
    return undefined;
  }
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find(item => item.trim().startsWith('sdk.dir='));
  return line ? line.slice(line.indexOf('=') + 1).trim() : undefined;
}

/** PATH 里没有 adb 时，退回 ANDROID_HOME / local.properties 指向的 SDK。 */
function resolveAdb() {
  if (process.env.ADB) {
    return process.env.ADB;
  }
  const probe = spawnSync('adb', ['version'], { stdio: 'ignore' });
  if (!probe.error && probe.status === 0) {
    return 'adb';
  }
  const sdkDirs = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    readLocalSdkDir(),
  ].filter(item => typeof item === 'string' && item.length > 0);
  for (const sdk of sdkDirs) {
    const candidate = path.join(
      sdk,
      'platform-tools',
      process.platform === 'win32' ? 'adb.exe' : 'adb',
    );
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function listDevices(adb) {
  const { status, stdout, stderr } = capture(adb, ['devices']);
  if (status !== 0) {
    fail(`adb devices 执行失败: ${stderr.trim() || '未知错误'}`);
  }
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('*'))
    .map(line => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    })
    .filter(device => typeof device.serial === 'string');
}

/**
 * 只接受状态为 device 的真机。
 * 不用 -e/-d 语义：连接的物理设备与模拟器可能同时存在，必须显式挑选。
 */
function pickDevice(adb, wantedSerial) {
  const devices = listDevices(adb);
  if (devices.length === 0) {
    fail('未检测到真机：请连接设备并开启 USB 调试（本项目不使用模拟器验收）');
  }
  const ready = devices.filter(device => device.state === 'device');
  const pending = devices.filter(device => device.state !== 'device');
  const describe = list =>
    list.map(device => `${device.serial}（${device.state}）`).join('、');

  if (wantedSerial) {
    const target = ready.find(device => device.serial === wantedSerial);
    if (!target) {
      fail(
        `设备 ${wantedSerial} 不在就绪列表。当前就绪: ${
          ready.length > 0 ? describe(ready) : '无'
        }${pending.length > 0 ? `；未就绪: ${describe(pending)}` : ''}`,
      );
    }
    return target;
  }
  if (ready.length === 0) {
    fail(`没有已授权就绪的设备。未就绪: ${describe(pending)}`);
  }
  if (ready.length > 1) {
    fail(
      `检测到多台就绪真机（${describe(
        ready,
      )}），请用 --serial <序列号> 指定目标设备`,
    );
  }
  return ready[0];
}

function collectApks(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectApks(full));
    } else if (entry.isFile() && entry.name.endsWith('.apk')) {
      found.push(full);
    }
  }
  return found;
}

function cleanApks() {
  const removed = [];
  for (const apk of collectApks(apkRoot)) {
    rmSync(apk, { force: true });
    removed.push(apk);
  }
  return removed;
}

function relative(file) {
  return path.relative(repoRoot, file);
}

function pickApk() {
  const apks = collectApks(path.join(apkRoot, 'release'));
  if (apks.length === 0) {
    fail('构建完成后未找到 release APK，请检查 Gradle 输出');
  }
  return (
    apks.find(apk => path.basename(apk) === 'app-release.apk') ?? apks[0]
  );
}

function modelOf(adb, serial) {
  const { status, stdout } = capture(adb, [
    '-s',
    serial,
    'shell',
    'getprop',
    'ro.product.model',
  ]);
  return status === 0 ? stdout.trim() : '';
}

const args = process.argv.slice(2);
const cleanOnly = args.includes('--clean-only');
const serialIndex = args.indexOf('--serial');
const wantedSerial = serialIndex >= 0 ? args[serialIndex + 1] : undefined;

if (serialIndex >= 0 && (!wantedSerial || wantedSerial.startsWith('--'))) {
  fail('--serial 需要提供设备序列号');
}

if (cleanOnly) {
  const removed = cleanApks();
  if (removed.length === 0) {
    console.log('✓ 没有遗留的 APK');
  } else {
    console.log(`✓ 已清理 ${removed.length} 个 APK`);
    for (const file of removed) {
      console.log(`  - ${relative(file)}`);
    }
  }
  process.exit(0);
}

const adb = resolveAdb();
if (!adb) {
  fail('找不到 adb：请把 platform-tools 加入 PATH，或设置 ANDROID_HOME');
}

const device = pickDevice(adb, wantedSerial);

console.log('▶ 构建 release APK…');
const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
if (run(gradle, ['assembleRelease'], { cwd: path.join(repoRoot, 'android') }) !== 0) {
  fail('release 构建失败，已保留现有构建产物');
}

const apk = pickApk();
console.log(`▶ 安装到 ${device.serial}：${relative(apk)}`);
if (run(adb, ['-s', device.serial, 'install', '-r', apk]) !== 0) {
  fail('安装失败，APK 保留在构建目录用于排查');
}

const removed = cleanApks();
const model = modelOf(adb, device.serial);
console.log(
  `✓ 已安装到真机 ${device.serial}${model ? `（${model}）` : ''}`,
);
if (removed.length === 0) {
  console.log('✓ 构建目录没有需要清理的 APK');
} else {
  console.log(`✓ 已清理 ${removed.length} 个安装包`);
  for (const file of removed) {
    console.log(`  - ${relative(file)}`);
  }
}
