import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelConfigAiModelHub } from '../src/ui.js';
import { TooltipProvider } from '@nimiplatform/kit/ui';
import type {
  AppModelConfigSurface,
  SharedAIConfigService,
} from '@nimiplatform/kit/core/model-config';
import type {
  NimiAIConfig,
  NimiAIScopeRef,
} from '@nimiplatform/kit/core/sdk-contract';
import { previewCopyFields } from './profile-preview-fixtures.js';
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

function wrap(node: ReactNode): ReactNode {
  return <TooltipProvider>{node}</TooltipProvider>;
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const scopeRef: NimiAIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

const baseConfig: NimiAIConfig = {
  scopeRef,
  capabilities: { targetRefs: {}, selectedParams: {} },
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
      previewApply: async () => { throw new Error('stub'); },
      apply: async () => ({
        success: false,
        config: null,
        failureReason: 'stub',
        outcome: 'failed',
        probeWarnings: [],
      }),
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
    ...previewCopyFields,
  },
  onSelectedProfileChange: () => undefined,
  onApply: () => undefined,
  onConfirmApply: () => undefined,
  onCancelPreview: () => undefined,
};

const ALL_SECTION_CAPABILITIES = [
  'text.generate', // chat
  'audio.synthesize', // tts
  'audio.transcribe', // stt
  'image.generate', // image
  'image.edit', // image edit
  'video.generate', // video
  'voice_workflow.voice_clone', // tts workflow
  'text.embed', // embed
  'world.generate', // world
];

function requirementDeclaration(capabilities: readonly string[]) {
  return {
    requirementId: 'desktop.chat.model-config',
    scopeRef,
    requiredSlices: capabilities.map((capability) => ({
      requirementSliceId: `req.${capability}`,
      capability,
      profileSliceRef: `slice.${capability}`,
      readinessPolicy: 'required' as const,
    })),
    setupProjectionPolicy: 'sdk-ai-config-setup-projection',
  };
}

function makeSurface(service: SharedAIConfigService): AppModelConfigSurface {
  return {
    scopeRef,
    aiConfigService: service,
    requirementDeclaration: requirementDeclaration(ALL_SECTION_CAPABILITIES),
    providerResolver: () => null,
    projectionResolver: () => null,
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

    // Section cards for all configured sections rendered. Voice workflow capabilities
    // live under TTS, so there is no separate voice section.
    const sectionKeys = ['chat', 'tts', 'stt', 'image', 'video', 'embed', 'world'];
    for (const section of sectionKeys) {
      expect(container?.textContent, `section ${section} title missing`).toContain(`ModelConfig.section.${section}.title`);
    }
  });

  it('derives section composition only from requirement declaration slices (image-only)', async () => {
    const service = stubService();
    const surface: AppModelConfigSurface = {
      ...makeSurface(service),
      requirementDeclaration: requirementDeclaration(['image.generate']),
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

  it('opens chat detail from grouped super-section layout without remount loops', async () => {
    const service = stubService();
    const surface: AppModelConfigSurface = {
      ...makeSurface(service),
      requirementDeclaration: requirementDeclaration(['text.generate', 'text.embed']),
    };
    await render(
      wrap(
        <ModelConfigAiModelHub
          surface={surface}
          profile={emptyProfileController}
          superSections={[{
            id: 'conversation',
            label: 'Conversation',
            sections: ['chat', 'embed'],
          }]}
        />,
      ),
    );

    const chatButton = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.textContent?.includes('ModelConfig.section.chat.title'));
    expect(chatButton).toBeTruthy();

    await act(async () => {
      click(chatButton as HTMLButtonElement);
      await flush();
      await flush();
    });

    expect(container?.textContent).toContain('ModelConfig.hub.detailTitleFormat');
    expect(container?.textContent).toContain('ModelConfig.editor.textGenerate.temperatureLabel');

    expect(container?.textContent).toContain('Setup required');
  });

  it('opens directly into an initial section for capability-specific drawers', async () => {
    const service = stubService();
    const surface: AppModelConfigSurface = {
      ...makeSurface(service),
      requirementDeclaration: requirementDeclaration(['text.generate', 'image.generate']),
    };
    const changes: Array<string | null> = [];
    await render(
      wrap(
        <ModelConfigAiModelHub
          surface={surface}
          profile={emptyProfileController}
          initialSection="chat"
          onActiveSectionChange={(section) => changes.push(section)}
        />,
      ),
    );

    expect(container?.textContent).toContain('ModelConfig.hub.detailTitleFormat');
    expect(container?.textContent).toContain('ModelConfig.editor.textGenerate.temperatureLabel');
    expect(container?.textContent).not.toContain('ModelConfig.section.image.title');
    expect(changes).toContain('chat');
  });

  it('renders active section only for capability drawer detail mode', async () => {
    const service = stubService();
    const surface: AppModelConfigSurface = {
      ...makeSurface(service),
      requirementDeclaration: requirementDeclaration(['text.generate', 'image.generate']),
    };
    await render(
      wrap(
        <ModelConfigAiModelHub
          surface={surface}
          profile={emptyProfileController}
          initialSection="chat"
          detailOnly
          detailHeaderAction={<button type="button">Close drawer</button>}
        />,
      ),
    );

    expect(container?.textContent).toContain('ModelConfig.hub.detailTitleFormat');
    expect(container?.textContent).toContain('ModelConfig.editor.textGenerate.temperatureLabel');
    expect(container?.textContent).toContain('Close drawer');
    expect(container?.textContent).not.toContain('Import AI Profile');
    expect(container?.textContent).not.toContain('ModelConfig.section.image.title');
    const backButton = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.getAttribute('aria-label') === 'ModelConfig.hub.backLabel');
    expect(backButton).toBeUndefined();
  });

  it('labels multiple capability cards in one section by capability instead of a generic active model label', async () => {
    const service = stubService();
    const surface: AppModelConfigSurface = {
      ...makeSurface(service),
      requirementDeclaration: requirementDeclaration(['image.generate', 'image.edit']),
    };
    await render(
      wrap(
        <ModelConfigAiModelHub
          surface={surface}
          profile={emptyProfileController}
          superSections={[{
            id: 'media',
            label: 'Media',
            sections: ['image'],
          }]}
        />,
      ),
    );

    const imageButton = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.textContent?.includes('ModelConfig.section.image.title'));
    expect(imageButton).toBeTruthy();

    await act(async () => {
      click(imageButton as HTMLButtonElement);
      await flush();
      await flush();
    });

    expect(container?.textContent).toContain('ModelConfig.capability.imageGenerate.title');
    expect(container?.textContent).toContain('ModelConfig.capability.imageEdit.title');
    expect(container?.textContent).not.toContain('ModelConfig.hub.activeModelLabel');
  });

  it('allows hosts to hide detail-view active model hints', async () => {
    const service = stubService();
    const surface: AppModelConfigSurface = {
      ...makeSurface(service),
      requirementDeclaration: requirementDeclaration(['image.generate', 'image.edit']),
    };
    await render(
      wrap(
        <ModelConfigAiModelHub
          surface={surface}
          profile={emptyProfileController}
          initialSection="image"
          detailActiveModelHint={null}
        />,
      ),
    );

    expect(container?.textContent).toContain('ModelConfig.capability.imageGenerate.title');
    expect(container?.textContent).toContain('ModelConfig.capability.imageEdit.title');
    expect(container?.textContent).not.toContain('Click to change model');
  });
});
