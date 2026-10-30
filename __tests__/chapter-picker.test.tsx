import React from 'react';
import { FlatList } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('../src/engine', () => {
  const actual = jest.requireActual('../src/engine');
  return {
    ...actual,
    loadDetail: jest.fn(async () => ({
      fields: { title: 'Picker Test' },
      chapters: Array.from({ length: 50 }, (_, index) => ({
        title: `第${String(index + 1).padStart(2, '0')}卷`,
        idCode: `${index + 1}`,
        url: `https://example.test/comic/1/${index + 1}.html`,
      })),
      pictures: [],
      urls: [],
      diagnostics: [],
    })),
  };
});

import { DetailScreen } from '../src/app/DetailScreen';
import { ReadingProgressRepository } from '../src/app/readingProgress';
import type { DebugSession } from '../src/app/debugReport';
import { buildRoutePlan } from '../src/engine';
import type { RuleDocument } from '../src/engine';

const rule: RuleDocument = {
  name: 'Picker',
  domain: 'example.test',
  detailUrl: 'https://example.test/comic/{idCode:}/',
};

const plan = buildRoutePlan(rule);

async function renderDetail(): Promise<
  ReturnType<typeof ReactTestRenderer.create>
> {
  let tree: ReturnType<typeof ReactTestRenderer.create> | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <DetailScreen
        siteName="Picker"
        siteId="site-1"
        domain="example.test"
        rule={rule}
        plan={plan}
        item={{ idCode: '1', title: 'Item' }}
        progress={new ReadingProgressRepository()}
        debug={{ record: () => undefined } as unknown as DebugSession}
        onBack={() => undefined}
      />,
    );
  });
  if (!tree) {
    throw new Error('tree not created');
  }
  return tree;
}

test('opens the chapter picker and filters by query', async () => {
  const tree = await renderDetail();

  const open = tree.root.findByProps({ testID: 'chapter-picker-open' });

  await ReactTestRenderer.act(async () => {
    open.props.onPress();
  });

  const filter = tree.root.findByProps({ testID: 'chapter-filter' });
  expect(tree.root.findByType(FlatList).props.data).toHaveLength(50);

  await ReactTestRenderer.act(async () => {
    filter.props.onChangeText('第05');
  });

  expect(tree.root.findByType(FlatList).props.data).toEqual([4]);
});
