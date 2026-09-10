import { useMemo, type ReactNode } from 'react';
import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  AIStudioHostProvider,
  type AIStudioHostPort,
  type StudioCapabilityRunInput,
  type StudioCapabilityRunResult,
} from '../ai-studio-core/index.js';
import { useLabRendererHost } from '../renderer/context.js';
import { appTitle } from '../shell/auth/app-identity.js';
import { useTranslation } from '../shell/i18n/index.js';
import {
  loadLabAIConfig,
  subscribeLabAIConfigOwnerRefresh,
} from './lab-ai-config-store.js';
import { createLabRunTargetSummary } from './lab-run-target.js';

export function LabAIStudioAdapter({ children }: { readonly children: ReactNode }) {
  const rendererHost = useLabRendererHost();
  const { t, i18n } = useTranslation();
  const value = useMemo<AIStudioHostPort>(() => ({
    appTitle,
    translate: (key, values) => t(key, values),
    locale: i18n.language,
    clock: { now: () => rendererHost.clock.now() },
    app: {
      projection: {
        promptDraft: (key, enabled) => rendererHost.app.projection.promptDraft(key, enabled),
        projectRunTarget: (input) => createLabRunTargetSummary({
            capability: input.capability,
            runtime: input.runtime,
            config: input.config,
            configState: input.configState,
            configError: input.configError,
            standaloneViewerAvailable: hasElectronRuntime(),
          }),
        runStatusLabel: (status) => t({
          ready: 'StudioShell.runStatusReady',
          unavailable: 'StudioShell.runStatusUnavailable',
          failed: 'StudioShell.runStatusFailed',
          canceled: 'StudioShell.runStatusCanceled',
          'timed-out': 'StudioShell.runStatusTimedOut',
          'local-fixture': 'StudioShell.runStatusLocalFixture',
        }[status] ?? status),
      },
      events: {
        subscribeAIConfigRefresh: (listener) => subscribeLabAIConfigOwnerRefresh(listener, window, document),
      },
      commands: {
        savePromptDraft: (key, prompt, enabled) => rendererHost.app.commands.savePromptDraft(key, prompt, enabled),
        copyText: (text) => rendererHost.app.commands.copyText(text),
        exportText: (input) => rendererHost.app.commands.exportText(input),
      },
    },
    sdk: {
      runCapability: (input: StudioCapabilityRunInput): Promise<StudioCapabilityRunResult> => rendererHost.sdk.runCapability(input),
      listLocalAppVoiceAssets: () => rendererHost.sdk.listLocalAppVoiceAssets(),
      uploadLocalAppArtifact: (input) => rendererHost.sdk.uploadLocalAppArtifact(input),
      aiConfig: {
        get: async () => (await loadLabAIConfig(rendererHost.sdk.aiConfig)).config,
      },
      revealLocalAppAsset: (relativePath) => rendererHost.sdk.storage.assets.reveal(relativePath),
    },
  }), [i18n.language, rendererHost, t]);
  return <AIStudioHostProvider value={value}>{children}</AIStudioHostProvider>;
}
