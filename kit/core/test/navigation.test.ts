import { describe, expect, it } from 'vitest';
import { createNimiNavigation, type NimiNavigationLeaveGuard } from '../src/navigation.js';

type Position = { readonly id: 'page'; readonly object: string };
const position = (object: string): Position => ({ id: 'page', object });
const validate = (value: unknown): Position => {
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'id,object' || v.id !== 'page' || typeof v.object !== 'string' || !v.object.trim()) {
    throw new TypeError('Invalid page position.');
  }
  return { id: 'page', object: v.object.trim() };
};
const navigation = (beforeLeave?: NimiNavigationLeaveGuard<Position>) => createNimiNavigation({ initial: position('A'), validate, beforeLeave });

describe('window-local navigation', () => {
  it('moves across pages, replaces, deduplicates and truncates the old forward branch', async () => {
    const nav = navigation();
    expect(await nav.back()).toEqual({ status: 'unchanged' });
    await nav.push(position('B')); await nav.push(position('C'));
    await nav.back();
    expect(nav.getSnapshot().current.destination.object).toBe('B');
    await nav.forward();
    expect(nav.getSnapshot().current.destination.object).toBe('C');
    await nav.back(); await nav.push(position('D'));
    expect(nav.getSnapshot().canGoForward).toBe(false);
    await nav.replace(position('E'));
    expect(await nav.push(position(' E '))).toEqual({ status: 'unchanged' });
    await nav.back();
    expect(nav.getSnapshot().current.destination.object).toBe('B');
    await nav.back();
    expect(nav.getSnapshot().current.destination.object).toBe('A');
  });
  it('retains exactly the newest 100 positions', async () => {
    const nav = navigation();
    for (let i = 1; i <= 110; i++) await nav.push(position(String(i)));
    let count = 1;
    while (nav.getSnapshot().canGoBack) { await nav.back(); count++; }
    expect(count).toBe(100);
    expect(nav.getSnapshot().current.destination.object).toBe('11');
  });
  it('retains position and both sides of history on cancel and real guard rejection', async () => {
    let policy: 'allow' | 'cancel' | 'throw' = 'allow';
    const error = new Error('save rejected');
    const nav = navigation(() => { if (policy === 'throw') throw error; return policy; });
    await nav.push(position('B')); await nav.push(position('C')); await nav.back();
    const previous = nav.getSnapshot().current;
    policy = 'cancel';
    expect(await nav.back()).toEqual({ status: 'cancelled' });
    policy = 'throw';
    expect(await nav.push(position('D'))).toEqual({ status: 'failed', error });
    expect(nav.getSnapshot().current).toBe(previous);
    expect(nav.getSnapshot().canGoBack).toBe(true);
    expect(nav.getSnapshot().canGoForward).toBe(true);
  });
  it('admits one pending decision, does not queue requests, and invalidates late approval on reset', async () => {
    let resolve!: (decision: 'allow') => void;
    let signal!: AbortSignal;
    const nav = navigation(context => { signal = context.signal; return new Promise(r => { resolve = r; }); });
    const pending = nav.push(position('B'));
    expect(nav.getSnapshot().transitionState).toBe('pending');
    expect(await nav.push(position('C'))).toEqual({ status: 'busy' });
    nav.reset(position('new-scope'));
    expect(signal.aborted).toBe(true);
    resolve('allow');
    expect(await pending).toEqual({ status: 'invalidated' });
    expect(nav.getSnapshot().current.destination.object).toBe('new-scope');
    expect(nav.getSnapshot().canGoBack).toBe(false);
  });
  it('cancels pending work and releases history/subscriptions on dispose', async () => {
    let resolve!: (decision: 'allow') => void;
    const nav = navigation(() => new Promise(r => { resolve = r; }));
    const pending = nav.push(position('B'));
    nav.dispose(); resolve('allow');
    expect(await pending).toEqual({ status: 'invalidated' });
    expect(await nav.forward()).toEqual({ status: 'disposed' });
    expect(nav.getSnapshot().transitionState).toBe('disposed');
  });
  it('rejects unknown/extra fields, isolates caller mutation, and keeps subscription snapshots stable', async () => {
    const nav = navigation();
    const first = nav.getSnapshot();
    expect(nav.getSnapshot()).toBe(first);
    expect((await nav.push({ ...position('B'), payload: 'business data' } as Position)).status).toBe('invalid');
    const target = { id: 'page' as const, object: 'B' };
    await nav.push(target); target.object = 'C';
    expect(nav.getSnapshot().current.destination.object).toBe('B');
    expect(Object.isFrozen(nav.getSnapshot().current.destination)).toBe(true);
  });
  it('revisits references without executing business actions', async () => {
    let sends = 0;
    const nav = navigation();
    const explicitSend = () => { sends++; };
    await nav.push(position('conversation')); explicitSend();
    await nav.push(position('result')); await nav.back(); await nav.forward();
    expect(sends).toBe(1);
  });
});
