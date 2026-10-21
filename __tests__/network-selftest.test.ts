import { runNetworkSelftest } from '../src/platform/networkSelftest';
import type { RuleFetcher } from '../src/engine';

test('runs the public Aba page through loadListPages with a real rule', async () => {
  const fetcher: RuleFetcher = {
    async fetch(request) {
      return {
        url: request.url,
        status: 200,
        body: `
          <div class="entry-content">
            <p class="wp-block-paragraph">[10/05] <a href="https://wc3818290.home.blog/2024/12/01/foo/">Manga Raw</a> - 更新</p>
            <p class="wp-block-paragraph">[09/16] <a href="https://wc3818290.home.blog/2026/01/07/bar/">パイパンコン</a> - 更新</p>
          </div>
        `,
      };
    },
  };

  const results = await runNetworkSelftest(fetcher);
  expect(results).toHaveLength(3);
  expect(results.every(result => result.ok)).toBe(true);
  expect(results[1].detail).toContain('items=2');
});
