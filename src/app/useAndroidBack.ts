import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/**
 * 接管 Android 返回键与返回手势。
 *
 * RN 的监听是「后注册先触发」：阅读器挂在详情页里、详情页挂在列表里，
 * 所以子页面天然比父页面晚注册，返回时自然先关最上层。
 *
 * 处理函数返回 true 表示已消费；返回 false 表示这一层没有可关闭的东西，
 * 事件继续交给下一个监听，最终由系统退出应用。
 */
export function useAndroidBack(handler: () => boolean, enabled = true): void {
  // 用 ref 存最新处理函数，避免每次渲染重新注册监听。
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => latest.current(),
    );
    return () => subscription.remove();
  }, [enabled]);
}
