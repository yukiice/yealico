import { createSerializedRenderer } from '../src/platform/serializedRenderer';
import type { WebViewRendererLike } from '../src/platform/webviewFetcher';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('createSerializedRenderer', () => {
  it('并发渲染会排队，峰值并发为 1', async () => {
    let running = 0;
    let peak = 0;
    const gates = [deferred<void>(), deferred<void>()];
    let call = 0;

    const inner: WebViewRendererLike = {
      async render() {
        const index = call;
        call += 1;
        running += 1;
        peak = Math.max(peak, running);
        await gates[index].promise;
        running -= 1;
        return { url: `https://example.test/${index}`, body: `<html>${index}</html>` };
      },
      async renderHtml() {
        return { url: 'about:blank', body: '' };
      },
    };

    const renderer = createSerializedRenderer(inner);
    const first = renderer.render('https://example.test/a');
    const second = renderer.render('https://example.test/b');

    await flush();
    expect(running).toBe(1);

    gates[0].resolve();
    await flush();
    expect(running).toBe(1);

    gates[1].resolve();
    const results = await Promise.all([first, second]);
    expect(peak).toBe(1);
    expect(results.map(item => item.url)).toEqual([
      'https://example.test/0',
      'https://example.test/1',
    ]);
  });

  it('前一个失败不会阻塞后续任务', async () => {
    const inner: WebViewRendererLike = {
      async render(url) {
        if (url.includes('bad')) {
          throw new Error('render failed');
        }
        return { url, body: '<html>ok</html>' };
      },
      async renderHtml() {
        return { url: 'about:blank', body: '' };
      },
    };

    const renderer = createSerializedRenderer(inner);
    await expect(renderer.render('https://example.test/bad')).rejects.toThrow(
      'render failed',
    );
    await expect(renderer.render('https://example.test/good')).resolves.toEqual({
      url: 'https://example.test/good',
      body: '<html>ok</html>',
    });
  });

  it('render 与 renderHtml 共用同一个队列', async () => {
    const order: string[] = [];
    const gate = deferred<void>();

    const inner: WebViewRendererLike = {
      async render(url) {
        order.push(`render:${url}`);
        await gate.promise;
        return { url, body: '' };
      },
      async renderHtml(html) {
        order.push(`html:${html.length}`);
        return { url: 'about:blank', body: '' };
      },
    };

    const renderer = createSerializedRenderer(inner);
    const first = renderer.render('https://example.test/a');
    const second = renderer.renderHtml('<p>x</p>', 'https://example.test/');
    await flush();
    expect(order).toEqual(['render:https://example.test/a']);

    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual([
      'render:https://example.test/a',
      'html:8',
    ]);
  });
});
