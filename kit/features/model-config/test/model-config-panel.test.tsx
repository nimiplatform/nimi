import { act, type ReactNode } from 'react';
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
});
