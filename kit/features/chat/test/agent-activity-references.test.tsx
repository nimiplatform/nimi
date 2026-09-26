import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NimiAppActivityRecord, NimiLocalAppActivityClient, NimiLocalAppAgentReference } from '@nimiplatform/kit/core/sdk-contract';
import { useAgentActivityReferences } from '../src/runtime/agent-activity-references.js';
import { AgentActivityReferences } from '../src/components/agent-activity-references.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Agent chat published Activity references', () => {
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
