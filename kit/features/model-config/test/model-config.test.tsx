import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelConfigAIConfigSurface } from '../src/components/model-config-ai-config-surface.js';
import type { ModelConfigOverwrite } from '../src/types.js';
import {
  modelConfigCapabilityPosture,
  modelConfigMissingRequiredFeatures,
  projectModelConfigLocalSelections,
} from '../src/projection.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderSurface(onOverwrite: ModelConfigOverwrite) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ModelConfigAIConfigSurface
        context={{ owner: 'app-ai-config', consumer: 'nimi-first-party', appId: 'test.app' }}
        capabilityContracts={['text.generate']}
        capabilities={null}
        localSelections={[{
          capabilityContract: 'text.generate',
          state: 'missing',
          configurationId: null,
          displayName: null,
          supportedFeatures: [],
          reasons: [],
        }]}
        onOverwrite={onOverwrite}
      />,
    );
    await Promise.resolve();
  });
  return container;
}

describe('public Model Config contract', () => {
  it('projects selected, broken, and feature-mismatch machine context without owning it', () => {
    const selections = projectModelConfigLocalSelections({
      selections: [
        { capabilityContract: 'text.generate', configurationId: 'text-local' },
        { capabilityContract: 'audio.transcribe', configurationId: 'missing' },
      ],
      configurations: [{
        configurationId: 'text-local',
        capabilityContract: 'text.generate',
        displayName: 'Local text',
        supportedFeatures: ['json.output'],
        interpretability: 'interpretable',
        requirementResolution: 'configured',
        reasons: [],
      }],
    });

    expect(selections.map((entry) => entry.state)).toEqual(['selected', 'broken']);
    const intent = {
      capabilityContract: 'text.generate',
      requiredFeatures: ['json.output', 'tool.use'],
      defaults: undefined,
      route: { oneofKind: 'local' as const, local: {} },
    };
    expect(modelConfigMissingRequiredFeatures(intent, selections[0])).toEqual(['tool.use']);
    expect(modelConfigCapabilityPosture(intent, selections[0])).toBe('local-feature-mismatch');
  });

  it('commits canonical App AIConfig intent through the owner callback', async () => {
    const onOverwrite = vi.fn<ModelConfigOverwrite>(async () => undefined);
    const node = await renderSurface(onOverwrite);
    const boundary = node.querySelector('[data-nimi-model-config-owner]') as HTMLElement;
    expect(boundary.getAttribute('data-nimi-model-config-owner')).toBe('app-ai-config');
    expect(boundary.getAttribute('data-nimi-model-config-app-id')).toBe('test.app');

    const save = node.querySelector(
      '[data-testid="model-config-save:text.generate"]',
    ) as HTMLButtonElement;
    await act(async () => { save.click(); await Promise.resolve(); });

    expect(onOverwrite).toHaveBeenCalledTimes(1);
    expect(onOverwrite.mock.calls[0]?.[0]).toEqual([{
      capabilityContract: 'text.generate',
      requiredFeatures: [],
      defaults: undefined,
      route: { oneofKind: 'local', local: {} },
    }]);
    expect(JSON.stringify(onOverwrite.mock.calls[0]?.[0])).not.toMatch(/modelId|targetRef|configurationId/u);
  });
});
