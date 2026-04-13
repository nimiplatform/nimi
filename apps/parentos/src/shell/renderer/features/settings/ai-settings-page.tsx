import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ModelConfigPanel,
  type ModelConfigProfileCopy,
  type ModelConfigSection,
} from '@nimiplatform/nimi-kit/features/model-config';
import type { RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import { useAppStore } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import {
  PARENTOS_AI_SCOPE_REF,
  PARENTOS_CAPABILITIES,
  bindingFromConfig,
  createEmptyParentosAIConfig,
} from './parentos-ai-config.js';
import { getParentosAIConfigService } from './parentos-ai-config-service.js';
import {
  ParentosSpeechTranscribeParamsEditor,
  ParentosTextGenerateParamsEditor,
} from './parentos-model-config-editors.js';
import { useParentosModelConfigProfileController } from './parentos-model-config-profile-controller.js';
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

function createProfileCopy(): ModelConfigProfileCopy {
  return {
    sectionTitle: 'AI Profile',
    summaryLabel: '运行时配置模板',
    emptySummaryLabel: '未应用模板',
    applyButtonLabel: '应用模板',
    changeButtonLabel: '更换模板',
    manageButtonTitle: '运行时模板',
    modalTitle: '应用 AI Profile',
    modalHint: '应用模板会一次性覆盖 ParentOS 当前的模型绑定和能力参数设置。',
    loadingLabel: '正在加载运行时模板...',
    emptyLabel: '当前没有可用的运行时模板。',
    currentBadgeLabel: '当前',
    cancelLabel: '取消',
    confirmLabel: '确认并应用',
    applyingLabel: '应用中...',
    reloadLabel: '刷新',
  };
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

  const profile = useParentosModelConfigProfileController({
    scopeRef: PARENTOS_AI_SCOPE_REF,
    currentOrigin: config.profileOrigin
      ? { profileId: config.profileOrigin.profileId, title: config.profileOrigin.title }
      : null,
    copy: createProfileCopy(),
  });

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

  const sections = useMemo<ModelConfigSection[]>(() => {
    const textParams = (config.capabilities.selectedParams['text.generate'] || {}) as Record<string, unknown>;
    const transcribeParams = (config.capabilities.selectedParams['audio.transcribe'] || {}) as Record<string, unknown>;

    return [
      {
        id: 'chat',
        title: 'AI 对话',
        items: [
          {
            capabilityId: 'text.generate',
            routeCapability: 'text.generate',
            label: 'AI 对话模型',
            detail: '用于成长顾问、日志标签、报告生成、体检 OCR 等',
            binding: bindingFromConfig(config, 'text.generate'),
            provider: providers['text.generate'] || null,
            onBindingChange: (binding) => updateConfig((current) => ({
              ...current,
              capabilities: {
                ...current.capabilities,
                selectedBindings: {
                  ...current.capabilities.selectedBindings,
                  'text.generate': binding,
                },
              },
            })),
            placeholder: '选择模型',
            runtimeNotReadyLabel: runtimeStatusLabel,
            editor: (
              <ParentosTextGenerateParamsEditor
                binding={bindingFromConfig(config, 'text.generate')}
                onBindingChange={(binding) => updateConfig((current) => ({
                  ...current,
                  capabilities: {
                    ...current.capabilities,
                    selectedBindings: {
                      ...current.capabilities.selectedBindings,
                      'text.generate': binding,
                    },
                  },
                }))}
                pickerAvailable={Boolean(providers['text.generate'])}
                pickerUnavailableHint={pickerUnavailableHint}
                params={textParams}
                onChange={(params) => updateConfig((current) => ({
                  ...current,
                  capabilities: {
                    ...current.capabilities,
                    selectedParams: {
                      ...current.capabilities.selectedParams,
                      'text.generate': params,
                    },
                  },
                }))}
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
            binding: bindingFromConfig(config, 'audio.transcribe'),
            provider: providers['audio.transcribe'] || null,
            onBindingChange: (binding) => updateConfig((current) => ({
              ...current,
              capabilities: {
                ...current.capabilities,
                selectedBindings: {
                  ...current.capabilities.selectedBindings,
                  'audio.transcribe': binding,
                },
              },
            })),
            placeholder: '选择模型',
            runtimeNotReadyLabel: runtimeStatusLabel,
            editor: (
              <ParentosSpeechTranscribeParamsEditor
                binding={bindingFromConfig(config, 'audio.transcribe')}
                onBindingChange={(binding) => updateConfig((current) => ({
                  ...current,
                  capabilities: {
                    ...current.capabilities,
                    selectedBindings: {
                      ...current.capabilities.selectedBindings,
                      'audio.transcribe': binding,
                    },
                  },
                }))}
                pickerAvailable={Boolean(providers['audio.transcribe'])}
                pickerUnavailableHint={pickerUnavailableHint}
                params={transcribeParams}
                onChange={(params) => updateConfig((current) => ({
                  ...current,
                  capabilities: {
                    ...current.capabilities,
                    selectedParams: {
                      ...current.capabilities.selectedParams,
                      'audio.transcribe': params,
                    },
                  },
                }))}
              />
            ),
            showEditorWhen: 'always',
            showClearButton: true,
            clearSelectionLabel: '清除模型选择',
          },
        ],
      },
    ];
  }, [config, pickerUnavailableHint, providers, runtimeStatusLabel, updateConfig]);

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
          <ModelConfigPanel profile={profile} sections={sections} />
        </div>
      </div>
    </div>
  );
}
