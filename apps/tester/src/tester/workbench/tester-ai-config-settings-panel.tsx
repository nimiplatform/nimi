import { useEffect, useMemo, useState } from 'react';
import type { CanonicalCapabilitySectionId } from '@nimiplatform/kit/core/runtime-capabilities';
import type { AppModelConfigSurface, LocalAssetEntry } from '@nimiplatform/kit/features/model-config';
import { listNimiRuntimeLocalAssetEntries } from '@nimiplatform/sdk/runtime';
import type { TesterRuntimeInspection } from '../tester-runtime.js';
import {
  createTesterAIConfigService,
  createTesterAppLabAIScopeRef,
  importTesterAIProfileJson,
} from '../tester-ai-config-store.js';
import { createTesterRuntimeModelPickerProviderCache } from '../tester-runtime-model-provider.js';
import { TesterAiConfigSettings } from '../../shell/ai/tester-ai-config-settings.js';
import { testerModelConfigCopy } from '../../shell/ai/model-config-copy.js';
import { getRuntimePlatformProjection } from '../../shell/auth/runtime-platform.js';

// App-owned wrapper: injects the tester's app-scoped NimiAIConfig service, scope
// ref, runtime model-picker provider, and copy into the scaffold-managed
// sectioned TesterAiConfigSettings. The AI config itself is the admitted kit
// model-config surface — this file only carries tester-specific wiring + copy.
// AI config now lives in Settings (and the AI Capabilities gear opens it to a
// specific section via `initialSection`).

type TesterAiConfigSettingsPanelProps = {
  runtime: TesterRuntimeInspection | null;
  initialSection?: CanonicalCapabilitySectionId | null;
  onClose?: () => void;
};

// Full canonical capability set the desktop tester configured. Capability ids
// not present in the kit catalog are filtered out by selectEnabledDescriptors.
const enabledCapabilities = [
  'text.generate',
  'text.embed',
  'audio.synthesize',
  'audio.transcribe',
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
  'image.generate',
  'video.generate',
  'world.generate',
] as const;

// Authoritative kit model-config copy (derived from the platform en locale),
// with a few tester-specific phrasing overrides for the panel chrome.
const copy: Record<string, string> = {
  ...testerModelConfigCopy,
  'ModelConfig.profile.importLabel': 'Apply AI Profile',
  'ModelConfig.profile.modalHint': 'Choose an imported profile, preview the App Lab AIConfig diff, then confirm.',
  'Tester.settings.title': 'AI model config',
  'Tester.settings.subtitle': 'Bind a Runtime model per capability for this app.',
  'Tester.settings.detailSubtitle': 'Configure models and defaults for this capability.',
};

function useTesterRuntimeLocalAssetSource(runtimeReady: boolean): AppModelConfigSurface['localAssetSource'] {
  const [assets, setAssets] = useState<LocalAssetEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!runtimeReady) {
      setAssets([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    void getRuntimePlatformProjection()
      .then(async (projection) => {
        if (projection.status !== 'ready') {
          return [];
        }
        return listNimiRuntimeLocalAssetEntries(projection.client.runtime);
      })
      .then((next) => {
        if (cancelled) return;
        setAssets(next.map((asset) => ({
          localAssetId: asset.localAssetId,
          assetId: asset.assetId,
          kind: asset.kind,
          engine: asset.engine,
          status: asset.status,
          artifactRoles: asset.artifactRoles,
        })));
      })
      .catch(() => {
        if (!cancelled) {
          setAssets([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runtimeReady]);

  return useMemo(() => ({
    list: () => assets,
    loading,
  }), [assets, loading]);
}

export function TesterAiConfigSettingsPanel({ runtime, initialSection = null, onClose }: TesterAiConfigSettingsPanelProps) {
  const scopeRef = useMemo(() => createTesterAppLabAIScopeRef(), []);
  const service = useMemo(() => createTesterAIConfigService(), []);
  const resolveRuntimeModelPickerProvider = useMemo(() => createTesterRuntimeModelPickerProviderCache(), []);
  const localAssetSource = useTesterRuntimeLocalAssetSource(runtime?.status === 'ready');

  return (
    <TesterAiConfigSettings
      scopeRef={scopeRef}
      service={service}
      enabledCapabilities={enabledCapabilities}
      providerResolver={resolveRuntimeModelPickerProvider}
      localAssetSource={localAssetSource}
      runtimeReady={runtime?.status === 'ready'}
      runtimeDetail={runtime?.detail ?? null}
      copy={copy}
      initialSection={initialSection}
      variant="capability-drawer"
      onClose={onClose}
      onImportProfileJson={(json) => {
        const result = importTesterAIProfileJson(json);
        return result.ok
          ? { ok: true, message: result.message, profileId: result.profile.profileId }
          : { ok: false, message: result.message, errors: result.errors };
      }}
    />
  );
}
