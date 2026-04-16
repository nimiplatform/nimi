import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ModelConfigPanel,
  type ModelConfigSection,
} from '@nimiplatform/nimi-kit/features/model-config';
import type { RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import { useAppStore } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import {
  PARENTOS_AI_SCOPE_REF,
  PARENTOS_CAPABILITIES,
  bindingFromConfig,
  createEmptyParentosAIConfig,
  type ParentosCapabilityId,
} from './parentos-ai-config.js';
import { getParentosAIConfigService } from './parentos-ai-config-service.js';
import {
  ParentosBindingEditor,
  ParentosSpeechTranscribeParamsEditor,
  ParentosTextGenerateParamsEditor,
} from './parentos-model-config-editors.js';
import { getParentosRouteModelPickerProvider } from './parentos-route-model-picker-provider.js';
import {
  parentosAISettingsAvailabilityBannerCopy,
  parentosAISettingsAvailabilityHint,
  parentosAISettingsAvailabilityLabel,
  probeParentosAISettingsAvailability,
  type ParentosAISettingsAvailability,
} from './parentos-ai-settings-availability.js';

function useCapabilityProviders(runtimeReady: boolean): Record<string, RouteModelPickerDataProvider | null> {
  return useMemo(() => {
    const providers: Record<string, RouteModelPickerDataProvider | null> = {};
    for (const cap of PARENTOS_CAPABILITIES) {
      if (providers[cap.routeCapability] === undefined) {
        if (!runtimeReady) {
          providers[cap.routeCapability] = null;
          continue;
        }
        providers[cap.routeCapability] = getParentosRouteModelPickerProvider(cap.routeCapability);
      }
    }
    return providers;
  }, [runtimeReady]);
}

export default function AiSettingsPage() {
  const config = useAppStore((state) => state.aiConfig) ?? createEmptyParentosAIConfig();
  const surface = useMemo(() => getParentosAIConfigService(), []);
  const [availability, setAvailability] = useState<ParentosAISettingsAvailability | null>(null);
  const runtimeReady = availability?.kind === 'ready';
  const providers = useCapabilityProviders(runtimeReady);
  const pickerUnavailableHint = parentosAISettingsAvailabilityHint(availability);
  const runtimeStatusLabel = parentosAISettingsAvailabilityLabel(availability);
  const bannerCopy = parentosAISettingsAvailabilityBannerCopy(availability);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nextAvailability = await probeParentosAISettingsAvailability();
      if (!cancelled) {
        setAvailability(nextAvailability);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateConfig = useCallback((updater: (current: typeof config) => typeof config) => {
    const next = updater(config);
    surface.aiConfig.update(PARENTOS_AI_SCOPE_REF, next);
  }, [config, surface]);

  const updateBinding = useCallback((capabilityId: ParentosCapabilityId, binding: RuntimeRouteBinding | null) => {
    updateConfig((current) => ({
      ...current,
      capabilities: {
        ...current.capabilities,
        selectedBindings: {
          ...current.capabilities.selectedBindings,
          [capabilityId]: binding,
        },
      },
    }));
  }, [updateConfig]);

  const updateParams = useCallback((capabilityId: ParentosCapabilityId, params: Record<string, unknown>) => {
    updateConfig((current) => ({
      ...current,
      capabilities: {
        ...current.capabilities,
        selectedParams: {
          ...current.capabilities.selectedParams,
          [capabilityId]: params,
        },
      },
    }));
  }, [updateConfig]);

  const sections = useMemo<ModelConfigSection[]>(() => {
    const textParams = (config.capabilities.selectedParams['text.generate'] || {}) as Record<string, unknown>;
    const transcribeParams = (config.capabilities.selectedParams['audio.transcribe'] || {}) as Record<string, unknown>;
    const textBinding = bindingFromConfig(config, 'text.generate');
    const visionBinding = bindingFromConfig(config, 'text.generate.vision');
    const speechBinding = bindingFromConfig(config, 'audio.transcribe');

    return [
      {
        id: 'chat',
        title: 'AI 对话',
        items: [
          {
            capabilityId: 'text.generate',
            routeCapability: 'text.generate',
            label: 'AI 对话模型',
            detail: '用于成长提问、日志标签与分析报告生成',
            binding: textBinding,
            provider: providers['text.generate'] || null,
            onBindingChange: (binding) => updateBinding('text.generate', binding),
            placeholder: '选择模型',
            runtimeNotReadyLabel: runtimeStatusLabel,
            editor: (
              <ParentosTextGenerateParamsEditor
                binding={textBinding}
                onBindingChange={(binding) => updateBinding('text.generate', binding)}
                pickerAvailable={Boolean(providers['text.generate'])}
                pickerUnavailableHint={pickerUnavailableHint}
                params={textParams}
                onChange={(params) => updateParams('text.generate', params)}
              />
            ),
            showEditorWhen: 'always',
            showClearButton: true,
            clearSelectionLabel: '清除模型选择',
          },
        ],
      },
      {
        id: 'vision',
        title: '智能识别',
        items: [
          {
            capabilityId: 'text.generate.vision',
            routeCapability: 'text.generate.vision',
            label: '智能识别模型',
            detail: '单独用于验光单、眼轴单、体检单等图片识别，不再跟随聊天模型',
            binding: visionBinding,
            provider: providers['text.generate.vision'] || null,
            onBindingChange: (binding) => updateBinding('text.generate.vision', binding),
            placeholder: '选择模型',
            runtimeNotReadyLabel: runtimeStatusLabel,
            editor: (
              <ParentosBindingEditor
                binding={visionBinding}
                onBindingChange={(binding) => updateBinding('text.generate.vision', binding)}
                pickerAvailable={Boolean(providers['text.generate.vision'])}
                pickerUnavailableHint={pickerUnavailableHint}
              />
            ),
            showEditorWhen: 'always',
            showClearButton: true,
            clearSelectionLabel: '清除模型选择',
          },
        ],
      },
      {
        id: 'voice',
        title: '语音',
        items: [
          {
            capabilityId: 'audio.transcribe',
            routeCapability: 'audio.transcribe',
            label: '语音转写模型',
            detail: '用于语音观察记录转文字',
            binding: speechBinding,
            provider: providers['audio.transcribe'] || null,
            onBindingChange: (binding) => updateBinding('audio.transcribe', binding),
            placeholder: '选择模型',
            runtimeNotReadyLabel: runtimeStatusLabel,
            editor: (
              <ParentosSpeechTranscribeParamsEditor
                binding={speechBinding}
                onBindingChange={(binding) => updateBinding('audio.transcribe', binding)}
                pickerAvailable={Boolean(providers['audio.transcribe'])}
                pickerUnavailableHint={pickerUnavailableHint}
                params={transcribeParams}
                onChange={(params) => updateParams('audio.transcribe', params)}
              />
            ),
            showEditorWhen: 'always',
            showClearButton: true,
            clearSelectionLabel: '清除模型选择',
          },
        ],
      },
    ];
  }, [config, pickerUnavailableHint, providers, runtimeStatusLabel, updateBinding, updateParams]);

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'transparent' }}>
      <div className={S.container} style={{ paddingTop: S.topPad }}>
        <div className="mb-6 flex items-center gap-3">
          <Link
            to="/settings"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={S.text} strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold" style={{ color: S.text }}>AI 模型设置</h1>
        </div>

        {bannerCopy && (
          <div
            className={`${S.radiusSm} mb-4 px-4 py-3 text-[12px]`}
            style={bannerCopy.kind === 'warning'
              ? { background: '#fef9e7', color: '#92400e', border: '1px solid #fde68a' }
              : { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}
          >
            {bannerCopy.message}
          </div>
        )}

        <div className={`${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}>
          <ModelConfigPanel sections={sections} />
        </div>
      </div>
    </div>
  );
}
