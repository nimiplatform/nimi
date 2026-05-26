import { beforeEach, describe, expect, it } from 'vitest';
import {
  selectAssetOpsBatchRuns,
  useAssetOpsBatchStore,
} from './asset-ops-batch-store.js';

const storage = new Map<string, string>();

describe('asset-ops-batch-store', () => {
  beforeEach(() => {
    storage.clear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    useAssetOpsBatchStore.setState((state) => ({ ...state, profiles: {} }));
  });

  it('creates a batch run with pending and skipped items', () => {
    const run = useAssetOpsBatchStore.getState().createRun({
      userId: 'user-1',
      workspaceId: 'ws-1',
      worldId: 'world-1',
      kind: 'AGENT_MISSING_DELIVERABLES',
      label: 'Missing agent deliverables',
      items: [
        {
          workspaceId: 'ws-1',
          worldId: 'world-1',
          family: 'agent-avatar',
          entityId: 'agent-1',
          label: 'Ari: generate avatar',
          task: {
            kind: 'AGENT_IMAGE',
            agentId: 'agent-1',
            family: 'agent-avatar',
            agentName: 'Ari',
            agentConcept: 'Archivist',
            worldName: 'Archive Realm',
            worldDescription: 'A city of memory.',
          },
        },
        {
          workspaceId: 'ws-1',
          worldId: 'world-1',
          family: 'agent-cover',
          entityId: null,
          label: 'Canonical agent id required',
          task: null,
          status: 'SKIPPED',
          lastError: 'Canonical agent id is required before batch asset generation can start.',
        },
      ],
    });

    expect(run?.items).toHaveLength(2);
    expect(run?.status).toBe('PENDING');

    const runs = selectAssetOpsBatchRuns(useAssetOpsBatchStore.getState().profiles, {
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.items.map((item) => item.status)).toEqual(['PENDING', 'SKIPPED']);
  });

  it('tracks running, failed, retried, and succeeded item transitions', () => {
    const run = useAssetOpsBatchStore.getState().createRun({
      userId: 'user-1',
      workspaceId: 'ws-1',
      worldId: 'world-1',
      kind: 'WORLD_MISSING_DELIVERABLES',
      label: 'Missing world families',
      items: [
        {
          workspaceId: 'ws-1',
          worldId: 'world-1',
          family: 'world-background',
          entityId: 'world-1',
          label: 'Generate Background',
          task: {
            kind: 'WORLD_IMAGE',
            worldId: 'world-1',
            family: 'world-background',
            worldName: 'Archive Realm',
            worldDescription: 'A city of memory.',
            worldOverview: 'Moonlit towers.',
          },
        },
      ],
    });
    const itemId = run?.items[0]?.id;
    expect(run && itemId).toBeTruthy();

    useAssetOpsBatchStore.getState().markItemRunning({
      userId: 'user-1',
      runId: run!.id,
      itemId: itemId!,
    });
    let currentRun = selectAssetOpsBatchRuns(useAssetOpsBatchStore.getState().profiles, {
      userId: 'user-1',
      workspaceId: 'ws-1',
    })[0];
    expect(currentRun?.status).toBe('RUNNING');
    expect(currentRun?.items[0]?.attemptCount).toBe(1);

    useAssetOpsBatchStore.getState().markItemFailed({
      userId: 'user-1',
      runId: run!.id,
      itemId: itemId!,
      error: 'provider timeout',
    });
    currentRun = selectAssetOpsBatchRuns(useAssetOpsBatchStore.getState().profiles, {
      userId: 'user-1',
      workspaceId: 'ws-1',
    })[0];
    expect(currentRun?.status).toBe('FAILED');
    expect(currentRun?.items[0]?.lastError).toBe('provider timeout');

    useAssetOpsBatchStore.getState().retryFailedRun({
      userId: 'user-1',
      runId: run!.id,
    });
    currentRun = selectAssetOpsBatchRuns(useAssetOpsBatchStore.getState().profiles, {
      userId: 'user-1',
      workspaceId: 'ws-1',
    })[0];
    expect(currentRun?.status).toBe('PENDING');
    expect(currentRun?.items[0]?.status).toBe('PENDING');

    useAssetOpsBatchStore.getState().markItemRunning({
      userId: 'user-1',
      runId: run!.id,
      itemId: itemId!,
    });
    useAssetOpsBatchStore.getState().markItemSucceeded({
      userId: 'user-1',
      runId: run!.id,
      itemId: itemId!,
      resultSummary: 'Queued candidate resource-1.',
    });
    currentRun = selectAssetOpsBatchRuns(useAssetOpsBatchStore.getState().profiles, {
      userId: 'user-1',
      workspaceId: 'ws-1',
    })[0];
    expect(currentRun?.status).toBe('SUCCEEDED');
    expect(currentRun?.items[0]?.resultSummary).toContain('Queued candidate');
  });
});
