import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelConfigAiModelHub } from '../src/ui.js';
import type {
  AppModelConfigSurface,
  SharedAIConfigService,
} from '@nimiplatform/nimi-kit/core/model-config';
import type {
  AIConfig,
  AIScopeRef,
} from '@nimiplatform/sdk/mod';
import type { ModelConfigProfileController } from '../src/types.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

if (!window.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

const scopeRef: AIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

const baseConfig: AIConfig = {
  scopeRef,
  capabilities: { selectedBindings: {}, localProfileRefs: {}, selectedParams: {} },
  profileOrigin: null,
};

function stubService(): SharedAIConfigService {
  return {
    aiConfig: {
      get: () => baseConfig,
      update: () => undefined,
      subscribe: () => () => undefined,
    },
    aiProfile: {
      list: async () => [],
      apply: async () => ({ success: false, config: null, failureReason: 'stub', probeWarnings: [] }),
    },
  };
}

const emptyProfileController: ModelConfigProfileController = {
  currentOrigin: null,
  profiles: [],
  selectedProfileId: null,
  isLoading: false,
  isReloading: false,
  error: null,
  applying: false,
  copy: {
    sectionTitle: 'Profile',
    summaryLabel: 'AI Profile',
    emptySummaryLabel: 'No profile applied',
    applyButtonLabel: 'Apply',
    changeButtonLabel: 'Change',
    manageButtonTitle: 'Manage',
    modalTitle: 'Apply profile',
    modalHint: 'Select a profile.',
    loadingLabel: 'Loading...',
    emptyLabel: 'No profiles available.',
    currentBadgeLabel: 'Current',
    cancelLabel: 'Cancel',
    confirmLabel: 'Apply',
    applyingLabel: 'Applying...',
    importLabel: 'Import AI Profile',
  },
  onSelectedProfileChange: () => undefined,
  onApply: () => undefined,
};

const ALL_SECTION_CAPABILITIES = [
  'text.generate', // chat
  'audio.synthesize', // tts
  'audio.transcribe', // stt
  'image.generate', // image
  'video.generate', // video
  'voice_workflow.tts_v2v', // voice
  'text.embed', // embed
  'world.generate', // world
];

function makeSurface(service: SharedAIConfigService): AppModelConfigSurface {
  return {
    scopeRef,
    aiConfigService: service,
    enabledCapabilities: ALL_SECTION_CAPABILITIES,
    providerResolver: () => null,
    projectionResolver: () => null,
    runtimeReady: true,
    i18n: { t: (key) => key },
  };
}

describe('ModelConfigAiModelHub', () => {
  it('renders exactly one ProfileConfigSection (import-button) for a fixture covering all 8 sections', async () => {
    const service = stubService();
    const surface = makeSurface(service);
    await render(
      <ModelConfigAiModelHub surface={surface} profile={emptyProfileController} />,
    );

    const importButtons = Array.from(container?.querySelectorAll('button') || [])
      .filter((button) => button.textContent?.includes('Import AI Profile') || button.textContent?.includes('AI Profile'));
    expect(importButtons.length).toBeGreaterThanOrEqual(1);

    const importButtonsStrict = Array.from(container?.querySelectorAll('button') || [])
      .filter((button) => button.textContent?.includes('Import AI Profile'));
    expect(importButtonsStrict.length).toBe(1);

    // Section cards for all 8 sections rendered (section.chat.title etc. appears once each).
    const sectionKeys = ['chat', 'tts', 'stt', 'image', 'video', 'voice', 'embed', 'world'];
    for (const section of sectionKeys) {
      expect(container?.textContent, `section ${section} title missing`).toContain(`ModelConfig.section.${section}.title`);
    }
  });

  it('derives section composition only from enabledCapabilities (image-only)', async () => {
    const service = stubService();
    const surface: AppModelConfigSurface = {
      ...makeSurface(service),
      enabledCapabilities: ['image.generate'],
    };
    await render(
      <ModelConfigAiModelHub surface={surface} profile={emptyProfileController} />,
    );
    expect(container?.textContent).toContain('ModelConfig.section.image.title');
    expect(container?.textContent).not.toContain('ModelConfig.section.voice.title');
    expect(container?.textContent).not.toContain('ModelConfig.section.stt.title');
    const importButtons = Array.from(container?.querySelectorAll('button') || [])
      .filter((button) => button.textContent?.includes('Import AI Profile'));
    expect(importButtons.length).toBe(1);
  });
});
