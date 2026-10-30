import assert from 'node:assert/strict';
import test from 'node:test';

test('World browsing survives a six-minute departure, refreshes in background, and expires after thirty idle minutes', async t => {
  // Query core selects browser GC defaults from the presence of window; this
  // headless cache test does not need a DOM or a mounted QueryClientProvider.
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  const { QueryObserver } = await import('@tanstack/react-query');
  const { createDesktopQueryClient } = await import('../src/shell/renderer/infra/query-client/query-client.js');
  const client = createDesktopQueryClient();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2026-10-30T00:00:00Z') });
  const subscriptions: (() => void)[] = [];
  try {
    const queries = ['world-catalog', 'world-list-item', 'world-topics'].map(prefix => {
      let calls = 0;
      let finishRefresh: (value: string) => void = () => {};
      const options = { queryKey: [prefix, 'realm-a', 'query-a'], staleTime: 30_000,
        queryFn: () => ++calls === 1 ? Promise.resolve('accepted') : new Promise<string>(resolve => { finishRefresh = resolve; }) };
      return { options, calls: () => calls, finish: () => finishRefresh('updated') };
    });
    for (const { options } of queries) await client.fetchQuery(options);
    await client.fetchQuery({ queryKey: ['unrelated'], queryFn: async () => 'other' });
    t.mock.timers.tick(6 * 60_000);
    assert.equal(client.getQueryData(['unrelated']), undefined, 'unrelated cache lifetimes are unchanged');
    for (const query of queries) {
      assert.equal(client.getQueryData(query.options.queryKey), 'accepted');
      assert.equal(client.getQueryData([query.options.queryKey[0], 'realm-b', 'query-a']), undefined);
      assert.equal(client.getQueryData([query.options.queryKey[0], 'realm-a', 'query-b']), undefined);
      const observer = new QueryObserver(client, query.options);
      const unsubscribe = observer.subscribe(() => {}); subscriptions.push(unsubscribe);
      assert.equal(observer.getCurrentResult().data, 'accepted');
      assert.equal(observer.getCurrentResult().isPending, false);
      assert.equal(observer.getCurrentResult().isFetching, true);
      assert.equal(query.calls(), 2, 'retention does not extend freshness');
      query.finish();
      await client.fetchQuery(query.options);
      assert.equal(observer.getCurrentResult().data, 'updated');
      unsubscribe();
    }
    t.mock.timers.tick(29 * 60_000);
    for (const { options } of queries) assert.equal(client.getQueryData(options.queryKey), 'updated');
    t.mock.timers.tick(60_000);
    for (const { options } of queries) assert.equal(client.getQueryData(options.queryKey), undefined);
    client.setQueryData(queries[0]!.options.queryKey, 'accepted again');
    client.clear();
    assert.equal(client.getQueryCache().getAll().length, 0, 'explicit session/cache cleanup still clears World data');
  } finally {
    for (const unsubscribe of subscriptions) unsubscribe();
    client.clear(); t.mock.timers.reset();
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
  }
});
