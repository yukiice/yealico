import {
  CHROME_AUTO_HIDE_MS,
  estimateOffset,
  preloadWindow,
  resolveReaderTap,
} from '../src/app/ReaderScreen';

describe('resolveReaderTap', () => {
  const width = 400;

  it('左侧 30% 翻上一页', () => {
    expect(resolveReaderTap(0, width)).toBe('prev');
    expect(resolveReaderTap(119, width)).toBe('prev');
  });

  it('右侧 30% 翻下一页', () => {
    expect(resolveReaderTap(281, width)).toBe('next');
    expect(resolveReaderTap(400, width)).toBe('next');
  });

  it('中间区域切换工具栏', () => {
    expect(resolveReaderTap(120, width)).toBe('toggle');
    expect(resolveReaderTap(200, width)).toBe('toggle');
    expect(resolveReaderTap(280, width)).toBe('toggle');
  });

  it('宽度未知或非法坐标时不翻页', () => {
    expect(resolveReaderTap(10, 0)).toBe('toggle');
    expect(resolveReaderTap(Number.NaN, width)).toBe('toggle');
  });

  it('自动隐藏时长是正数', () => {
    expect(CHROME_AUTO_HIDE_MS).toBeGreaterThan(0);
  });
});

describe('preloadWindow', () => {
  const images = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

  it('包含当前页与前后窗口', () => {
    expect(preloadWindow(images, 3, 2, 1)).toEqual(['c', 'd', 'e', 'f']);
  });

  it('窗口越界时自动收缩', () => {
    expect(preloadWindow(images, 0, 2, 2)).toEqual(['a', 'b', 'c']);
    expect(preloadWindow(images, 6, 2, 1)).toEqual(['f', 'g']);
  });

  it('空列表返回空', () => {
    expect(preloadWindow([], 0)).toEqual([]);
  });
});

describe('estimateOffset', () => {
  it('已知块用真实高度，未知块用默认比例估算', () => {
    const blocks = [{ height: 1000 }, undefined, { height: 500 }];
    // 1000 + 400/0.7 + 500 ≈ 2071
    expect(Math.round(estimateOffset(3, blocks, 400))).toBe(2071);
  });

  it('目标为 0 时偏移为 0', () => {
    expect(estimateOffset(0, [], 400)).toBe(0);
  });
});
