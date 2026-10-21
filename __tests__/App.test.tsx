/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import App from '../App';

test('renders P1 selftest summary', async () => {
  let tree: ReturnType<typeof ReactTestRenderer.create> | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  const output = JSON.stringify(tree?.toJSON());
  expect(output).toContain('Yealico 自检');
  expect(output).toContain('全部通过');
});
