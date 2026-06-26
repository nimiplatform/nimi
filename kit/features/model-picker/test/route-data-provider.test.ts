import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSnapshotRouteDataProvider,
  type RouteOptionsSnapshot,
  type UseRouteModelPickerDataResult,
  useRouteModelPickerData,
} from '../src/route-data.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// createSnapshotRouteDataProvider
// ---------------------------------------------------------------------------

type RouteInventoryTarget = RouteOptionsSnapshot['inventory']['targets'][number];

type LocalTargetInput = {
  localModelId: string;
  profileBindingId?: string;
  readinessRef?: string;
  omitTargetRefIdentity?: boolean;
  model?: string;
  modelId?: string;
  engine?: string;
  status?: string;
  capabilities?: readonly string[];
};

type CloudTargetInput = {
  connectorId: string;
  provider: string;
  modelId: string;
  remoteModelCatalogId?: string;
  modelLabel?: string;
  capabilities?: readonly string[];
};

function localTarget(input: LocalTargetInput): RouteInventoryTarget {
  const targetRef: RouteInventoryTarget['targetRef'] = {
    kind: 'local-runtime',
    version: 'v2',
  };
  if (!input.omitTargetRefIdentity) {
    if (input.profileBindingId) {
      targetRef.profileBindingId = input.profileBindingId;
    }
    if (input.readinessRef) {
      targetRef.readinessRef = input.readinessRef;
    }
    if (!targetRef.profileBindingId && !targetRef.readinessRef) {
      targetRef.profileBindingId = `runtime-profile:${input.localModelId}`;
    }
  }
  return {
    targetRef,
    display: {
      label: input.model || input.modelId || input.localModelId,
      model: input.model || input.modelId || input.localModelId,
      engine: input.engine || 'llama',
    },
    readiness: {
      status: input.status || 'active',
    },
    compatibility: {
      capabilities: input.capabilities || ['text.generate'],
    },
    evidence: {
      source: 'local-runtime',
      localAssetId: input.localModelId,
      resolvedModelId: input.modelId || input.model || input.localModelId,
      engine: input.engine || 'llama',
    },
  };
}

function cloudTarget(input: CloudTargetInput): RouteInventoryTarget {
  return {
    targetRef: {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId: input.connectorId,
      remoteModelCatalogId: input.remoteModelCatalogId || `remote-catalog:${input.connectorId}:${input.modelId}`,
      providerModelId: input.modelId,
      provider: input.provider,
    },
    display: {
      label: input.modelLabel || input.modelId,
      modelLabel: input.modelLabel || input.modelId,
      provider: input.provider,
    },
    readiness: {
      status: 'active',
    },
    compatibility: {
      capabilities: input.capabilities || ['text.generate'],
    },
    evidence: {
      source: 'cloud-connector',
      connectorId: input.connectorId,
      remoteModelCatalogId: input.remoteModelCatalogId || `remote-catalog:${input.connectorId}:${input.modelId}`,
      providerModelId: input.modelId,
      provider: input.provider,
    },
  };
}

function makeSnapshot(
  overrides?: Partial<RouteOptionsSnapshot> & { targets?: readonly RouteInventoryTarget[] },
): RouteOptionsSnapshot {
  const capability = overrides?.capability || 'text.generate';
  const targets = overrides?.targets || overrides?.inventory?.targets || [];
  return {
    capability,
    selectedTargetRef: overrides?.selectedTargetRef ?? null,
    inventory: {
      capability,
      targets,
    },
  };
}

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

describe('createSnapshotRouteDataProvider', () => {
  it('maps snapshot local models to RouteLocalModel list', async () => {
    const snapshot = makeSnapshot({
      targets: [
        localTarget({
          localModelId: 'local-qwen',
          profileBindingId: '01KLOCALQWEN',
          model: 'qwen3',
          modelId: 'qwen3',
          engine: 'llama',
          status: 'active',
          capabilities: ['chat'],
        }),
        localTarget({
          localModelId: 'local-flux',
          model: 'flux',
          modelId: 'flux',
          engine: 'media',
          status: 'installed',
          capabilities: ['image'],
        }),
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const models = await provider.listLocalModels();

    expect(models).toHaveLength(2);
    // active sorts before installed
    expect(models[0]!.localModelId).toBe('local-qwen');
    expect(models[0]!.goRuntimeLocalModelId).toBe('local-qwen');
    expect(models[0]!.profileBindingId).toBe('01KLOCALQWEN');
    expect(models[0]!.status).toBe('active');
    expect(models[1]!.localModelId).toBe('local-flux');
    expect(models[1]!.status).toBe('installed');
  });

  it('does not expose local inventory targets that lack a v2 durable target ref', async () => {
    const snapshot = makeSnapshot({
      targets: [
        localTarget({
          localModelId: 'local-missing-ref',
          model: 'missing-ref',
          omitTargetRefIdentity: true,
        }),
        localTarget({
          localModelId: 'local-ambiguous-ref',
          model: 'ambiguous-ref',
          profileBindingId: 'runtime-profile:ambiguous-ref',
          readinessRef: 'readiness:ambiguous-ref',
        }),
        localTarget({
          localModelId: 'local-ready-ref',
          model: 'ready-ref',
          readinessRef: 'readiness:local-ready-ref',
        }),
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const models = await provider.listLocalModels();

    expect(models).toHaveLength(1);
    expect(models[0]!.localModelId).toBe('local-ready-ref');
    expect(models[0]!.readinessRef).toBe('readiness:local-ready-ref');
  });

  it('maps snapshot connectors to RouteConnector list (cloud only)', async () => {
    const snapshot = makeSnapshot({
      targets: [
        cloudTarget({
          connectorId: 'connector-openai',
          provider: 'openai',
          modelId: 'gpt-4.1',
          capabilities: ['chat'],
        }),
        cloudTarget({
          connectorId: 'connector-openai',
          provider: 'openai',
          modelId: 'gpt-4.1-mini',
          capabilities: ['chat'],
        }),
        cloudTarget({
          connectorId: 'connector-anthropic',
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-6',
        }),
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const connectors = await provider.listConnectors();

    expect(connectors).toHaveLength(2);
    expect(connectors.map((c) => c.connectorId)).toEqual([
      'connector-openai',
      'connector-anthropic',
    ]);
  });

  it('returns connector models from inline snapshot data', async () => {
    const snapshot = makeSnapshot({
      targets: [
        cloudTarget({
          connectorId: 'connector-openai',
          provider: 'openai',
          modelId: 'gpt-4.1',
          capabilities: ['chat'],
        }),
        cloudTarget({
          connectorId: 'connector-openai',
          provider: 'openai',
          modelId: 'gpt-4.1-mini',
          capabilities: ['chat'],
        }),
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const models = await provider.listConnectorModels('connector-openai');

    expect(models).toHaveLength(2);
    expect(models.map((m) => m.modelId)).toEqual(['gpt-4.1', 'gpt-4.1-mini']);
    expect(models[0]!.available).toBe(true);
    expect(models[0]!.capabilities).toEqual(['chat']);
  });

  it('uses the snapshot capability for connector models without per-model capabilities', async () => {
    const snapshot = makeSnapshot({
      capability: 'voice_workflow.voice_clone',
      targets: [
        cloudTarget({
          connectorId: 'connector-dashscope',
          provider: 'dashscope',
          modelId: 'qwen3-tts-vc',
          capabilities: ['voice_workflow.voice_clone'],
        }),
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const models = await provider.listConnectorModels('connector-dashscope');

    expect(models).toHaveLength(1);
    expect(models[0]!.modelId).toBe('qwen3-tts-vc');
    expect(models[0]!.capabilities).toEqual(['voice_workflow.voice_clone']);
  });

  it('returns empty list for unknown connector id', async () => {
    const snapshot = makeSnapshot({
      targets: [
        cloudTarget({
          connectorId: 'connector-openai',
          provider: 'openai',
          modelId: 'gpt-4.1',
        }),
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const models = await provider.listConnectorModels('nonexistent');

    expect(models).toHaveLength(0);
  });

  it('excludes connectors with zero models', async () => {
    const snapshot = makeSnapshot({
      targets: [
        cloudTarget({
          connectorId: 'real-connector',
          provider: 'real',
          modelId: 'model-1',
        }),
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => snapshot);
    const connectors = await provider.listConnectors();

    expect(connectors).toHaveLength(1);
    expect(connectors[0]!.connectorId).toBe('real-connector');
  });

  it('fetches snapshot only once per cycle (caches across concurrent calls)', async () => {
    let fetchCount = 0;
    const snapshot = makeSnapshot({
      targets: [
        localTarget({ localModelId: 'a', model: 'a', status: 'active' }),
        cloudTarget({ connectorId: 'c', provider: 'p', modelId: 'm' }),
      ],
    });

    const provider = createSnapshotRouteDataProvider(async () => {
      fetchCount += 1;
      return snapshot;
    });

    // Call all three methods concurrently
    const [localModels, connectors, connectorModels] = await Promise.all([
      provider.listLocalModels(),
      provider.listConnectors(),
      provider.listConnectorModels('c'),
    ]);

    expect(fetchCount).toBe(1);
    expect(localModels).toHaveLength(1);
    expect(connectors).toHaveLength(1);
    expect(connectorModels).toHaveLength(1);
  });

  it('reuses the cached snapshot across sequential reads until invalidated', async () => {
    let fetchCount = 0;
    const provider = createSnapshotRouteDataProvider(async () => {
      fetchCount += 1;
      return makeSnapshot({
        targets: [cloudTarget({ connectorId: 'c', provider: 'p', modelId: 'm' })],
      });
    });

    await provider.listLocalModels();
    await provider.listConnectors();
    await provider.listConnectorModels('c');

    expect(fetchCount).toBe(1);

    provider.invalidate?.();
    await provider.listConnectors();

    expect(fetchCount).toBe(2);
  });

  it('does not cache a failed snapshot fetch forever', async () => {
    let fetchCount = 0;
    const provider = createSnapshotRouteDataProvider(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        throw new Error('temporary route failure');
      }
      return makeSnapshot({
        targets: [cloudTarget({ connectorId: 'c', provider: 'p', modelId: 'm' })],
      });
    });

    await expect(provider.listConnectors()).rejects.toThrow('temporary route failure');
    const connectors = await provider.listConnectors();

    expect(fetchCount).toBe(2);
    expect(connectors).toHaveLength(1);
  });
});

describe('useRouteModelPickerData', () => {
  it('previews the first available model without committing route selection truth', async () => {
    const provider = createSnapshotRouteDataProvider(async () => makeSnapshot({
      targets: [
        localTarget({
          localModelId: 'local-qwen',
          model: 'qwen3',
          modelId: 'qwen3',
          engine: 'llama',
          status: 'active',
          capabilities: ['text.generate'],
        }),
      ],
    }));
    const onSelectionChange = vi.fn();
    const latestState: { current: UseRouteModelPickerDataResult | null } = { current: null };

    function Harness() {
      latestState.current = useRouteModelPickerData({
        provider,
        capability: 'text.generate',
        onSelectionChange,
      });
      return null;
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(Harness));
      await flush();
      await flush();
    });

    expect(latestState.current).not.toBeNull();
    const loadedState = latestState.current as UseRouteModelPickerDataResult;
    expect(loadedState.selection.model).toBe('');
    expect(loadedState.pickerState.selectedId).toBe('local-qwen');
    expect(onSelectionChange).not.toHaveBeenCalled();

    await act(async () => {
      loadedState.pickerState.selectModel('local-qwen');
      await flush();
    });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({
      source: 'local',
      model: 'local-qwen',
      localModelId: 'local-qwen',
      modelId: 'qwen3',
    }));
  });

  it('selects the first cloud connector before loading capability-scoped models', async () => {
    const provider = createSnapshotRouteDataProvider(async () => makeSnapshot({
      capability: 'audio.synthesize',
      targets: [
        cloudTarget({
          connectorId: 'connector-dashscope',
          provider: 'dashscope',
          modelId: 'qwen3-tts-flash',
          capabilities: ['audio.synthesize'],
        }),
      ],
    }));
    const onSelectionChange = vi.fn();
    const latestState: { current: UseRouteModelPickerDataResult | null } = { current: null };

    function Harness() {
      latestState.current = useRouteModelPickerData({
        provider,
        capability: 'audio.synthesize',
        onSelectionChange,
      });
      return null;
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(Harness));
      await flush();
      await flush();
    });

    const loadedState = latestState.current as UseRouteModelPickerDataResult;
    await act(async () => {
      loadedState.changeSource('cloud');
      await flush();
      await flush();
    });

    const cloudState = latestState.current as UseRouteModelPickerDataResult;
    expect(cloudState.selection.source).toBe('cloud');
    expect(cloudState.selection.connectorId).toBe('connector-dashscope');
    expect(cloudState.pickerState.models.map((model) => cloudState.pickerState.adapter.getId(model))).toEqual(['qwen3-tts-flash']);
    expect(onSelectionChange).toHaveBeenCalledWith({
      source: 'cloud',
      connectorId: 'connector-dashscope',
      model: '',
    });
  });

  it('hydrates an initial cloud source with the first connector when no connector id is stored', async () => {
    const provider = createSnapshotRouteDataProvider(async () => makeSnapshot({
      capability: 'audio.synthesize',
      targets: [
        cloudTarget({
          connectorId: 'connector-dashscope',
          provider: 'dashscope',
          modelId: 'cosyvoice-v3.5-flash',
          capabilities: ['audio.synthesize'],
        }),
      ],
    }));
    const latestState: { current: UseRouteModelPickerDataResult | null } = { current: null };

    function Harness() {
      latestState.current = useRouteModelPickerData({
        provider,
        capability: 'audio.synthesize',
        initialSelection: { source: 'cloud' },
      });
      return null;
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(Harness));
      await flush();
      await flush();
      await flush();
    });

    const loadedState = latestState.current as UseRouteModelPickerDataResult;
    expect(loadedState.selection.connectorId).toBe('connector-dashscope');
    expect(loadedState.pickerState.models.map((model) => loadedState.pickerState.adapter.getId(model))).toEqual(['cosyvoice-v3.5-flash']);
  });

  it('replaces a stale cloud connector id with the first live connector', async () => {
    const provider = createSnapshotRouteDataProvider(async () => makeSnapshot({
      capability: 'audio.synthesize',
      targets: [
        cloudTarget({
          connectorId: 'connector-dashscope',
          provider: 'dashscope',
          modelId: 'qwen3-tts-flash',
          capabilities: ['audio.synthesize'],
        }),
      ],
    }));
    const latestState: { current: UseRouteModelPickerDataResult | null } = { current: null };

    function Harness() {
      latestState.current = useRouteModelPickerData({
        provider,
        capability: 'audio.synthesize',
        initialSelection: { source: 'cloud', connectorId: 'stale-connector' },
      });
      return null;
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(Harness));
      await flush();
      await flush();
      await flush();
    });

    const loadedState = latestState.current as UseRouteModelPickerDataResult;
    expect(loadedState.selection.connectorId).toBe('connector-dashscope');
    expect(loadedState.pickerState.models.map((model) => loadedState.pickerState.adapter.getId(model))).toEqual(['qwen3-tts-flash']);
  });
});
