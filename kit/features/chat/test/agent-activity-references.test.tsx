import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NimiAppActivityRecord, NimiLocalAppActivityClient, NimiLocalAppAgentReference } from '@nimiplatform/kit/core/sdk-contract';
import { useAgentActivityReferences, type AgentActivityReferencesState } from '../src/runtime/agent-activity-references.js';
import { AgentActivityReferences } from '../src/components/agent-activity-references.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Agent chat published Activity references', () => {
  it('keeps an unavailable unnamed source visible without inventing its identity or enabling open', async () => {
    const record = { activityId: 'retained-record', source: { kind: 'app', displayName: null, appId: null, available: false },
      title: 'Retained result', occurredAt: '2026-11-15T00:00:00Z', objectRef: 'original-object' } as unknown as NimiAppActivityRecord;
    const open = vi.fn();
    const container = document.createElement('div'); const root = createRoot(container);
    try {
      await act(async () => root.render(<AgentActivityReferences records={[record]} loading={false} unavailable={false} incomplete={false}
        openingId={null} openFailed={false} open={open} retry={() => {}} presentation="panel"
        copy={{ title: 'Published results', loading: 'Loading', unavailable: 'Read failed', incomplete: 'Partial', open: 'View in source App', opening: 'Opening',
          openFailed: 'Open failed', retry: 'Retry', more: 'More', sourceUnavailable: 'Source unavailable' }} />));
      expect(container.querySelector('article > div')?.textContent).toContain('Source unavailable');
      expect(container.textContent?.match(/Source unavailable/g)).toHaveLength(1);
      const button = container.querySelector('article button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      await act(async () => button.click());
      expect(open).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Retained result');
    } finally { await act(async () => root.unmount()); }
  });
  it('continues past a Runtime-only page, preserves failed continuation and opens only the current source object', async () => {
    const reference = { agentHandle: `agent_ref_${'A'.repeat(43)}`, activityAgentRef: 'agr_A' } as NimiLocalAppAgentReference;
    const record = (id: string, app: boolean): NimiAppActivityRecord => ({ activityId: id, key: id, revision: 1,
      source: { kind: app ? 'app' : 'runtime-agent', sourceRef: app ? 'source-app' : 'source-runtime', appId: app ? 'source.app' : null, displayName: 'Source', available: true },
      kind: 'activity', todoState: null, attention: false, title: id, summary: null, objectRef: app ? 'saved-object' : null, type: 'source.result.v1', data: null,
      agent: { agentRef: 'agr_A', displayName: 'Partner' }, occurredAt: '2026-11-15T00:00:00Z', publishedAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z', changeSeq: '1',
      userView: { readThroughRevision: 0, unread: true, needsAttention: false } });
    const published = record('published', true);
    const reads: Parameters<NimiLocalAppActivityClient['list']>[0][] = [];
    let continuation!: (page: Awaited<ReturnType<NimiLocalAppActivityClient['list']>>) => void;
    let fail!: (error: Error) => void;
    const activity = { list: vi.fn(async (input: Parameters<NimiLocalAppActivityClient['list']>[0]) => {
      reads.push(input);
      if (input?.filter?.sourceRef) return { records: [], nextPageToken: null, baselineChangeSeq: '1' };
      if (input?.pageToken) return new Promise<Awaited<ReturnType<NimiLocalAppActivityClient['list']>>>((resolve, reject) => { continuation = resolve; fail = reject; });
      return { records: Array.from({ length: 50 }, (_, i) => record(`turn-${i}`, false)), nextPageToken: 'older', baselineChangeSeq: '1' };
    }), subscribe: async () => ({ cancel: vi.fn(async () => {}), [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }),
      open: vi.fn(async () => ({ outcome: 'opened', reason: 'opened' })), markRead: vi.fn() } as unknown as NimiLocalAppActivityClient;
    const listReferences = async () => [reference];
    let state!: AgentActivityReferencesState;
    function Consumer({ sourceRef }: { sourceRef?: string }) {
      state = useAgentActivityReferences({ agentHandle: reference.agentHandle, activity, listReferences, sourceRef, pendingOnly: Boolean(sourceRef) });
      return <AgentActivityReferences {...state} presentation="panel" copy={{ title: 'Published', loading: 'Loading', unavailable: 'Unavailable', incomplete: 'Earlier pages remain', empty: 'No published activity', open: 'View source', opening: 'Opening', openFailed: 'Open failed', retry: 'Retry', more: 'Load earlier' }} />;
    }
    const container = document.createElement('div'); const root = createRoot(container);
    try {
      await act(async () => root.render(<Consumer />));
      await vi.waitFor(() => expect(state.hasMore).toBe(true));
      expect(state.records).toEqual([]);
      expect(container.textContent).toContain('Load earlier');
      expect(container.textContent).not.toContain('No published activity');
      await act(async () => state.loadMore());
      expect(state.loadingMore).toBe(true);
      await act(async () => fail(new Error('Temporary read failure')));
      expect(state.pageFailed).toBe(true);
      expect(state.hasMore).toBe(true);
      await act(async () => state.loadMore());
      await act(async () => continuation({ records: [published], nextPageToken: null, baselineChangeSeq: '1' }));
      expect(state.records).toEqual([published]);
      expect(state.hasMore).toBe(false);
      expect(reads.slice(1).map(read => read?.pageToken)).toEqual(['older', 'older']);
      await act(async () => state.open(published));
      expect(activity.open).toHaveBeenCalledWith({ activityId: 'published' });
      expect(activity.markRead).not.toHaveBeenCalled();
      const staleOpen = state.open;
      await act(async () => root.render(<Consumer sourceRef="different-source" />));
      expect(reads.at(-1)?.filter).toEqual({ agentRef: 'agr_A', sourceRef: 'different-source', kind: 'todo', todoStates: ['open'] });
      await act(async () => staleOpen(published));
      expect(activity.open).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
  });
  it('starts collapsed, retains source actions, and collapses only for a new explicit navigation key', async () => {
    const records = Array.from({ length: 3 }, (_, index) => ({ activityId: `activity-${index}`, source: { kind: 'app', appId: 'source.app', displayName: 'Source App' }, title: `Published result ${index}`, summary: 'Published summary', objectRef: `source-object-${index}`, occurredAt: '2026-10-27T00:00:00Z' })) as unknown as NimiAppActivityRecord[];
    const open = vi.fn(); const retry = vi.fn();
    const props = { records, loading: false, unavailable: false, incomplete: false, openingId: null, openFailed: false, open, retry,
      copy: { title: 'App references', loading: 'Loading', unavailable: 'Read unavailable', incomplete: 'Partial records', open: 'View in App', opening: 'Opening', openFailed: 'Open failed', retry: 'Retry', more: 'More' } };
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const render = async (navigationKey?: string, unavailable = false) => { await act(async () => root.render(<AgentActivityReferences {...props} navigationKey={navigationKey} unavailable={unavailable} />)); };
    try {
      await render('agent:1');
      const details = container.querySelector<HTMLDetailsElement>('[data-nimi-app-activity-references]')!;
      const summary = details.querySelector('summary')!;
      expect(details.open).toBe(false);
      expect(summary.textContent).toBe('App references');
      expect(container.textContent?.match(/App references/g)).toHaveLength(1);
      summary.focus(); expect(document.activeElement).toBe(summary);
      await act(async () => {
        summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        // JSDOM does not synthesize the native keyboard activation click.
        summary.click();
      });
      expect(details.open).toBe(true);
      const openButton = Array.from(details.querySelectorAll('button')).find(button => button.textContent === 'View in App')!;
      await act(async () => openButton.click()); expect(open).toHaveBeenCalledWith(records[0]);
      expect(container.textContent).toContain('Source App');
      await render('agent:1', true); expect(details.open).toBe(true);
      await act(async () => Array.from(details.querySelectorAll('button')).find(button => button.textContent === 'Retry')!.click());
      expect(retry).toHaveBeenCalledOnce();
      await render(undefined); expect(details.open).toBe(true);
      openButton.focus();
      await render('agent:2'); expect(details.open).toBe(false); expect(document.activeElement).toBe(summary);
      await act(async () => summary.click()); expect(details.open).toBe(true);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
  it('shows a read failure without claiming that an empty view contains partial records', () => {
    const props = {
      records: [], loading: false, unavailable: true, incomplete: true,
      openingId: null, openFailed: false, open: () => undefined, retry: () => undefined,
      copy: { title: 'App references', loading: 'Loading', unavailable: 'Read unavailable', incomplete: 'Partial records', open: 'View in App', opening: 'Opening', openFailed: 'Open failed', retry: 'Retry', more: 'More' },
    };
    const failed = renderToStaticMarkup(<AgentActivityReferences {...props} />);
    expect(failed).toContain('Read unavailable');
    expect(failed).toContain('Retry');
    expect(failed).not.toContain('Partial records');
    expect(renderToStaticMarkup(<AgentActivityReferences {...props} unavailable={false} incomplete={false} />)).toBe('');
    const record = { activityId: 'act_partial', source: { kind: 'app', displayName: 'Source App' }, title: 'Published result', occurredAt: '2026-09-26T10:00:00Z' } as NimiAppActivityRecord;
    const partial = renderToStaticMarkup(<AgentActivityReferences {...props} unavailable={false} records={[record]} />);
    expect(partial).toContain('Published result');
    expect(partial).toContain('Partial records');
  });

  it('uses the selected exact handle and its Activity correlation even when display names match', async () => {
    const references = ['A', 'B'].map(value => ({ agentHandle: `agent_ref_${value.repeat(43)}`, agentBinding: `agent_binding_${value.repeat(43)}`, activityAgentRef: `agr_${value}`, displayName: 'Same display name', avatarUrl: null })) as NimiLocalAppAgentReference[];
    const listReferences = vi.fn(async () => references);
    const list = vi.fn(async (_input: Parameters<NimiLocalAppActivityClient['list']>[0]) => ({ records: [], nextPageToken: null, baselineChangeSeq: '0' }));
    const cancel = vi.fn(async () => undefined);
    const activity = { list, subscribe: async () => ({ cancel, [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) }), open: vi.fn() } as unknown as Pick<NimiLocalAppActivityClient, 'list' | 'subscribe' | 'open'>;
    function Consumer() { useAgentActivityReferences({ agentHandle: references[1]!.agentHandle, listReferences, activity }); return null; }
    const container = document.createElement('div'); const root = createRoot(container);
    try {
      await act(async () => { root.render(<Consumer />); });
      await vi.waitFor(() => expect(list).toHaveBeenCalled());
      expect(list.mock.calls[0]?.[0]).toMatchObject({ filter: { agentRef: 'agr_B' } });
      expect(listReferences).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); }
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('renders only the finite published content and Agent attribution, never the publisher payload', () => {
    const record = { activityId: 'act_reference', source: { kind: 'app', displayName: 'Source App' }, title: 'Saved result', summary: 'Published summary', objectRef: 'existing-result', agent: { agentRef: 'agr_A', displayName: 'Selected Agent' }, occurredAt: '2026-09-25T12:00:00Z', data: { privateExecution: 'never-render-this-payload' } } as unknown as NimiAppActivityRecord;
    const html = renderToStaticMarkup(<AgentActivityReferences records={[record]} loading={false} unavailable={false} incomplete={false} openingId={null} openFailed={false} open={() => undefined} retry={() => undefined} copy={{ title: 'App references', loading: 'Loading', unavailable: 'Unavailable', incomplete: 'More', open: 'View in App', opening: 'Opening', openFailed: 'Unavailable', retry: 'Retry', more: 'More' }} />);
    for (const text of ['Source App', 'Selected Agent', 'Saved result', 'Published summary', 'View in App']) expect(html).toContain(text);
    expect(html).not.toContain('never-render-this-payload');
    expect(html).not.toContain('privateExecution');
  });
});
