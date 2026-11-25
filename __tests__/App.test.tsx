/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import App from '../App';

test('首次启动展示空态与添加入口', async () => {
  let tree: ReturnType<typeof ReactTestRenderer.create> | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  const output = JSON.stringify(tree?.toJSON());
  expect(output).toContain('Yealico');
  expect(output).toContain('还没有站点');
  expect(output).toContain('添加站点');
});
