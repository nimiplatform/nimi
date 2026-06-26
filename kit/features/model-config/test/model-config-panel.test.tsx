import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ImageParamsEditor,
  ModelConfigPanel,
  VideoParamsEditor,
  type ModelConfigPanelProps,
} from '../src/index.js';
import { previewCopyFields } from './profile-preview-fixtures.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

if (!window.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
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

async function render(node: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
    await flush();
    await flush();
  });
}

describe('ModelConfigPanel', () => {
  it('renders profile flow, status, and hides hidden sections', async () => {
    let appliedProfileId: string | null = null;
    const props: ModelConfigPanelProps = {
      profile: {
        currentOrigin: null,
        profiles: [
          { profileId: 'alpha', title: 'Alpha Profile', description: 'Primary config' },
        ],
        selectedProfileId: 'alpha',
        copy: {
          sectionTitle: 'Profile',
          summaryLabel: 'AI Profile',
          emptySummaryLabel: 'No profile applied',
          applyButtonLabel: 'Apply profile',
          changeButtonLabel: 'Change',
          manageButtonTitle: 'Manage profiles',
          modalTitle: 'Apply AI Profile',
          modalHint: 'Choose a profile.',
          loadingLabel: 'Loading...',
          emptyLabel: 'No profiles available.',
          currentBadgeLabel: 'Current',
          cancelLabel: 'Cancel',
          confirmLabel: 'Confirm & Apply',
          applyingLabel: 'Applying...',
          ...previewCopyFields,
        },
        onSelectedProfileChange: () => undefined,
        onApply: (profileId) => {
          appliedProfileId = profileId;
        },
        onConfirmApply: () => undefined,
        onCancelPreview: () => undefined,
      },
      sections: [
        {
          id: 'chat',
          title: 'Chat',
          items: [
            {
              capabilityId: 'text.generate',
              routeCapability: 'text.generate',
              label: 'Chat Model',
              targetRef: {
                kind: 'cloud-connector',
                connectorId: 'openai',
                remoteModelCatalogId: 'remote-catalog:openai:gpt-4.1-mini',
                providerModelId: 'gpt-4.1-mini',
              },
              onTargetRefChange: () => undefined,
              status: {
                supported: false,
                tone: 'attention',
                badgeLabel: 'Needs setup',
                title: 'Route unavailable',
                detail: 'Select a route for Chat.',
              },
              placeholder: 'Select a model',
            },
          ],
        },
        {
          id: 'image',
          title: 'Image',
          collapsible: true,
          defaultExpanded: true,
          items: [
            {
              capabilityId: 'image.generate',
              routeCapability: 'image.generate',
              label: 'Image Model',
              targetRef: null,
              onTargetRefChange: () => undefined,
              runtimeNotReadyLabel: 'Runtime not ready',
            },
          ],
        },
        {
          id: 'hidden',
          title: 'Hidden',
          hidden: true,
          content: <div>should not appear</div>,
        },
      ],
    };

    await render(<ModelConfigPanel {...props} />);

    expect(container?.textContent).toContain('AI Profile');
    expect(container?.textContent).toContain('Needs setup');
    expect(container?.textContent).toContain('Route unavailable');
    expect(container?.textContent).not.toContain('should not appear');

    const buttons = Array.from(container?.querySelectorAll('button') || []);
    const profileCard = buttons.find((button) => button.textContent?.includes('No profile applied'));
    expect(profileCard).toBeTruthy();

    await act(async () => {
      profileCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(container?.textContent).toContain('Alpha Profile');

    const confirmButton = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.textContent?.includes('Confirm & Apply'));

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(appliedProfileId).toBe('alpha');
  });

  it('propagates image and video editor changes', async () => {
    let nextImageSeed = '';
    let nextVideoMode = '';

    await render(
      <div>
        <ImageParamsEditor
          copy={{
            companionModelsLabel: 'Companion Models',
            parametersLabel: 'Parameters',
            sizeLabel: 'Size',
            responseFormatLabel: 'Response format',
            seedLabel: 'Seed',
            timeoutLabel: 'Timeout',
            stepsLabel: 'Steps',
            cfgScaleLabel: 'CFG Scale',
            samplerLabel: 'Sampler',
            schedulerLabel: 'Scheduler',
            customOptionsLabel: 'Custom options',
            noneLabel: 'None',
          }}
          params={{
            size: '512x512',
            responseFormat: 'auto',
            seed: '',
            timeoutMs: '600000',
            steps: '25',
            cfgScale: '',
            sampler: '',
            scheduler: '',
            optionsText: '',
          }}
          companionSlots={{}}
          assets={[]}
          onParamsChange={(next) => {
            nextImageSeed = next.seed;
          }}
          onCompanionSlotsChange={() => undefined}
        />
        <VideoParamsEditor
          copy={{
            parametersLabel: 'Parameters',
            modeLabel: 'Mode',
            ratioLabel: 'Ratio',
            durationLabel: 'Duration',
            resolutionLabel: 'Resolution',
            fpsLabel: 'FPS',
            seedLabel: 'Seed',
            timeoutLabel: 'Timeout',
            cameraFixedLabel: 'Fixed camera',
            generateAudioLabel: 'Generate audio',
          }}
          params={{
            mode: 't2v',
            ratio: '16:9',
            durationSec: '5',
            resolution: '',
            fps: '',
            seed: '',
            timeoutMs: '',
            negativePrompt: '',
            cameraFixed: false,
            generateAudio: false,
          }}
          onParamsChange={(next) => {
            nextVideoMode = next.mode;
          }}
        />
      </div>,
    );

    const seedInput = Array.from(container?.querySelectorAll('input') || [])
      .find((input) => input.getAttribute('placeholder') === null);
    expect(seedInput).toBeTruthy();

    if (seedInput instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(seedInput, '42');
      seedInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await act(async () => {
      const videoModeSelect = Array.from(document.querySelectorAll('select'))
        .find((select) => Array.from(select.options)
          .some((option) => option.textContent?.includes('Image to Video (reference)')));
      expect(videoModeSelect).toBeTruthy();
      if (videoModeSelect instanceof HTMLSelectElement) {
        videoModeSelect.value = 'i2v-reference';
        videoModeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await flush();
    });

    expect(nextImageSeed).toBe('42');
    expect(nextVideoMode).toBe('i2v-reference');
  });

  it('propagates image model family changes', async () => {
    let nextImageFamily = '';

    await render(
      <ImageParamsEditor
        copy={{
          modelFamilyLabel: 'Model type',
          companionModelsLabel: 'Companion Models',
          parametersLabel: 'Parameters',
          sizeLabel: 'Size',
          responseFormatLabel: 'Response format',
          seedLabel: 'Seed',
          timeoutLabel: 'Timeout',
          stepsLabel: 'Steps',
          cfgScaleLabel: 'CFG Scale',
          samplerLabel: 'Sampler',
          schedulerLabel: 'Scheduler',
          customOptionsLabel: 'Custom options',
          noneLabel: 'None',
        }}
        params={{
          modelFamily: '',
          size: '512x512',
          responseFormat: 'auto',
          seed: '',
          timeoutMs: '600000',
          steps: '25',
          cfgScale: '',
          sampler: '',
          scheduler: '',
          optionsText: '',
        }}
        companionSlots={{}}
        assets={[]}
        onParamsChange={(next) => {
          nextImageFamily = next.modelFamily ?? '';
        }}
        onCompanionSlotsChange={() => undefined}
      />,
    );

    const imageFamilySelect = Array.from(document.querySelectorAll('select'))
      .find((select) => Array.from(select.options)
        .some((option) => option.textContent?.includes('Ideogram4')));
    expect(imageFamilySelect).toBeTruthy();

    await act(async () => {
      if (imageFamilySelect instanceof HTMLSelectElement) {
        imageFamilySelect.value = 'ideogram4';
        imageFamilySelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await flush();
    });

    expect(nextImageFamily).toBe('ideogram4');
  });

  it('selects image companion slots through the shared picker interaction', async () => {
    let nextCompanionSlots: Record<string, string> = {};

    function ImageEditorHarness() {
      const [companionSlots, setCompanionSlots] = useState<Record<string, string>>({});
      return (
        <ImageParamsEditor
          copy={{
            companionModelsLabel: 'Companion Models',
            parametersLabel: 'Parameters',
            sizeLabel: 'Size',
            responseFormatLabel: 'Response format',
            seedLabel: 'Seed',
            timeoutLabel: 'Timeout',
            stepsLabel: 'Steps',
            cfgScaleLabel: 'CFG Scale',
            samplerLabel: 'Sampler',
            schedulerLabel: 'Scheduler',
            customOptionsLabel: 'Custom options',
            noneLabel: 'None',
          }}
          params={{
            size: '512x512',
            responseFormat: 'auto',
            seed: '',
            timeoutMs: '600000',
            steps: '25',
            cfgScale: '',
            sampler: '',
            scheduler: '',
            optionsText: '',
          }}
          companionSlots={companionSlots}
          assets={[{
            localAssetId: 'local-vae',
            assetId: 'Z Image AE',
            kind: 'vae',
            engine: 'media',
            status: 'installed',
          }]}
          onParamsChange={() => undefined}
          onCompanionSlotsChange={(next) => {
            nextCompanionSlots = next;
            setCompanionSlots(next);
          }}
        />
      );
    }

    await render(
      <ImageEditorHarness />,
    );

    expect(container?.textContent).toContain('Required');
    expect(container?.textContent).toContain('Required setup');

    const vaeTrigger = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.textContent?.includes('Required setup'));
    expect(vaeTrigger).toBeTruthy();

    await act(async () => {
      vaeTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const assetOption = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Z Image AE'));
    expect(assetOption).toBeTruthy();

    await act(async () => {
      assetOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(nextCompanionSlots).toEqual({ vae_path: 'local-vae' });
    const selectedVaeTrigger = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.textContent?.includes('Z Image AE'));
    expect(selectedVaeTrigger?.textContent).not.toContain('Required setup');
  });

  it('selects Ideogram4 uncond dependency assets by artifact role', async () => {
    let nextCompanionSlots: Record<string, string> = {};

    function ImageEditorHarness() {
      const [companionSlots, setCompanionSlots] = useState<Record<string, string>>({});
      return (
        <ImageParamsEditor
          copy={{
            modelFamilyLabel: 'Model type',
            companionModelsLabel: 'Companion Models',
            parametersLabel: 'Parameters',
            sizeLabel: 'Size',
            responseFormatLabel: 'Response format',
            seedLabel: 'Seed',
            timeoutLabel: 'Timeout',
            stepsLabel: 'Steps',
            cfgScaleLabel: 'CFG Scale',
            samplerLabel: 'Sampler',
            schedulerLabel: 'Scheduler',
            customOptionsLabel: 'Custom options',
            noneLabel: 'None',
            requiredLabel: 'Required',
            requiredSetupPlaceholder: 'Required setup',
          }}
          params={{
            modelFamily: 'ideogram4',
            size: '512x512',
            responseFormat: 'auto',
            seed: '',
            timeoutMs: '600000',
            steps: '25',
            cfgScale: '',
            sampler: '',
            scheduler: '',
            optionsText: '',
          }}
          companionSlots={companionSlots}
          assets={[
            {
              localAssetId: 'local-main-image',
              assetId: 'local-import/ideogram4-Q4_0',
              kind: 'image',
              engine: 'media',
              status: 'active',
              artifactRoles: ['diffusion_model'],
            },
            {
              localAssetId: 'local-uncond',
              assetId: 'local-import/ideogram4_uncond-Q4_0',
              kind: 'image',
              engine: 'media',
              status: 'installed',
              artifactRoles: ['uncond_diffusion_model'],
            },
          ]}
          onParamsChange={() => undefined}
          onCompanionSlotsChange={(next) => {
            nextCompanionSlots = next;
            setCompanionSlots(next);
          }}
        />
      );
    }

    await render(<ImageEditorHarness />);

    const uncondLabel = Array.from(container?.querySelectorAll('span[aria-label]') || [])
      .find((node) => node.getAttribute('aria-label') === 'Uncond diffusion');
    const uncondTrigger = uncondLabel?.parentElement?.querySelector('button');
    expect(uncondTrigger).toBeTruthy();
    expect(uncondTrigger?.textContent).toContain('Required setup');
    expect(uncondTrigger?.textContent).not.toContain('local-import/ideogram4-Q4_0');

    await act(async () => {
      uncondTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const modalButtons = Array.from(document.querySelectorAll('button'));
    expect(modalButtons.some((button) => button.textContent?.includes('local-import/ideogram4_uncond-Q4_0'))).toBe(true);
    expect(modalButtons.some((button) => button.textContent?.includes('local-import/ideogram4-Q4_0'))).toBe(false);

    const uncondOption = modalButtons.find((button) => button.textContent?.includes('local-import/ideogram4_uncond-Q4_0'));
    await act(async () => {
      uncondOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(nextCompanionSlots).toEqual({ uncond_diffusion_model: 'local-uncond' });
  });

  it('keeps Ideogram4 LLM companion selection on chat assets when image assets expose text encoder roles', async () => {
    await render(
      <ImageParamsEditor
        copy={{
          modelFamilyLabel: 'Model type',
          companionModelsLabel: 'Companion Models',
          parametersLabel: 'Parameters',
          sizeLabel: 'Size',
          responseFormatLabel: 'Response format',
          seedLabel: 'Seed',
          timeoutLabel: 'Timeout',
          stepsLabel: 'Steps',
          cfgScaleLabel: 'CFG Scale',
          samplerLabel: 'Sampler',
          schedulerLabel: 'Scheduler',
          customOptionsLabel: 'Custom options',
          noneLabel: 'None',
          requiredLabel: 'Required',
          requiredSetupPlaceholder: 'Required setup',
        }}
        params={{
          modelFamily: 'ideogram4',
          size: '512x512',
          responseFormat: 'auto',
          seed: '',
          timeoutMs: '600000',
          steps: '25',
          cfgScale: '',
          sampler: '',
          scheduler: '',
          optionsText: '',
        }}
        companionSlots={{}}
        assets={[
          {
            localAssetId: 'local-main-image',
            assetId: 'local-import/ideogram4-Q4_0',
            kind: 'image',
            engine: 'media',
            status: 'installed',
            artifactRoles: ['diffusion_transformer', 'text_encoder', 'vae'],
          },
          {
            localAssetId: 'local-chat',
            assetId: 'local-import/Qwen3-4B-Q4_K_M',
            kind: 'chat',
            engine: 'llama',
            status: 'active',
          },
        ]}
        onParamsChange={() => undefined}
        onCompanionSlotsChange={() => undefined}
      />,
    );

    const llmLabel = Array.from(container?.querySelectorAll('span[aria-label]') || [])
      .find((node) => node.getAttribute('aria-label') === 'LLM');
    const llmTrigger = llmLabel?.parentElement?.querySelector('button');
    expect(llmTrigger).toBeTruthy();

    await act(async () => {
      llmTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const modalButtons = Array.from(document.querySelectorAll('button'));
    expect(modalButtons.some((button) => button.textContent?.includes('local-import/Qwen3-4B-Q4_K_M'))).toBe(true);
    expect(modalButtons.some((button) => button.textContent?.includes('local-import/ideogram4-Q4_0'))).toBe(false);
  });

  it('does not treat the main Ideogram4 image model as the uncond dependency', async () => {
    await render(
      <ImageParamsEditor
        copy={{
          modelFamilyLabel: 'Model type',
          companionModelsLabel: 'Companion Models',
          parametersLabel: 'Parameters',
          sizeLabel: 'Size',
          responseFormatLabel: 'Response format',
          seedLabel: 'Seed',
          timeoutLabel: 'Timeout',
          stepsLabel: 'Steps',
          cfgScaleLabel: 'CFG Scale',
          samplerLabel: 'Sampler',
          schedulerLabel: 'Scheduler',
          customOptionsLabel: 'Custom options',
          noneLabel: 'None',
          requiredLabel: 'Required',
          requiredSetupPlaceholder: 'Required setup',
        }}
        params={{
          modelFamily: 'ideogram4',
          size: '512x512',
          responseFormat: 'auto',
          seed: '',
          timeoutMs: '600000',
          steps: '25',
          cfgScale: '',
          sampler: '',
          scheduler: '',
          optionsText: '',
        }}
        companionSlots={{ uncond_diffusion_model: 'local-main-image' }}
        assets={[{
          localAssetId: 'local-main-image',
          assetId: 'local-import/ideogram4-Q4_0',
          kind: 'image',
          engine: 'media',
          status: 'installed',
        }]}
        onParamsChange={() => undefined}
        onCompanionSlotsChange={() => undefined}
      />,
    );

    expect(container?.textContent).toContain('Required setup');
    expect(container?.textContent).not.toContain('local-import/ideogram4-Q4_0');

    const uncondLabel = Array.from(container?.querySelectorAll('span[aria-label]') || [])
      .find((node) => node.getAttribute('aria-label') === 'Uncond diffusion');
    const uncondTrigger = uncondLabel?.parentElement?.querySelector('button');
    expect(uncondTrigger).toBeTruthy();

    await act(async () => {
      uncondTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const modalButtons = Array.from(document.querySelectorAll('button'));
    expect(modalButtons.some((button) => button.textContent?.includes('local-import/ideogram4-Q4_0'))).toBe(false);
  });

  it('renders only dynamic family companion slots when supplied', async () => {
    await render(
      <ImageParamsEditor
        copy={{
          companionModelsLabel: 'Companion Models',
          parametersLabel: 'Parameters',
          sizeLabel: 'Size',
          responseFormatLabel: 'Response format',
          seedLabel: 'Seed',
          timeoutLabel: 'Timeout',
          stepsLabel: 'Steps',
          cfgScaleLabel: 'CFG Scale',
          samplerLabel: 'Sampler',
          schedulerLabel: 'Scheduler',
          customOptionsLabel: 'Custom options',
          noneLabel: 'None',
          requiredLabel: 'Required',
          requiredSetupPlaceholder: 'Required setup',
        }}
        params={{
          size: '512x512',
          responseFormat: 'auto',
          seed: '',
          timeoutMs: '600000',
          steps: '25',
          cfgScale: '',
          sampler: '',
          scheduler: '',
          optionsText: '',
        }}
        companionSlots={{}}
        companionSlotDefs={[
          { slot: 'llm_path', label: 'LLM', kind: 'chat', required: true },
          { slot: 'vae_path', label: 'VAE', kind: 'vae', required: true },
        ]}
        assets={[]}
        onParamsChange={() => undefined}
        onCompanionSlotsChange={() => undefined}
      />,
    );

    expect(container?.textContent).toContain('LLM');
    expect(container?.textContent).toContain('VAE');
    expect(container?.textContent).not.toContain('CLIP-L');
    expect(container?.textContent).not.toContain('ControlNet');
  });

  it('renders image family companion slots from params', async () => {
    await render(
      <ImageParamsEditor
        copy={{
          companionModelsLabel: 'Companion Models',
          parametersLabel: 'Parameters',
          sizeLabel: 'Size',
          responseFormatLabel: 'Response format',
          seedLabel: 'Seed',
          timeoutLabel: 'Timeout',
          stepsLabel: 'Steps',
          cfgScaleLabel: 'CFG Scale',
          samplerLabel: 'Sampler',
          schedulerLabel: 'Scheduler',
          customOptionsLabel: 'Custom options',
          noneLabel: 'None',
          requiredLabel: 'Required',
          requiredSetupPlaceholder: 'Required setup',
        }}
        params={{
          modelFamily: 'ideogram4',
          size: '512x512',
          responseFormat: 'auto',
          seed: '',
          timeoutMs: '600000',
          steps: '25',
          cfgScale: '',
          sampler: '',
          scheduler: '',
          optionsText: '',
        }}
        companionSlots={{}}
        assets={[]}
        onParamsChange={() => undefined}
        onCompanionSlotsChange={() => undefined}
      />,
    );

    expect(container?.textContent).toContain('Uncond diffusion');
    expect(container?.textContent).toContain('LLM');
    expect(container?.textContent).toContain('VAE');
    expect(container?.textContent).not.toContain('CLIP-L');
  });
});
