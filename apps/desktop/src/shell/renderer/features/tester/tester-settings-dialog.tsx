import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig, RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import {
  CapabilityModelCard,
  ImageParamsEditor,
  ProfileConfigSection,
  VideoParamsEditor,
  parseImageParams,
  parseVideoParams,
  type ImageParamsEditorCopy,
  type ModelConfigCapabilityItem,
  type ModelConfigProfileCopy,
  type VideoParamsEditorCopy,
} from '@nimiplatform/nimi-kit/features/model-config';
import { type RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import { ScrollArea, cn } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { DesktopIconToggleAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
import { dispatchRuntimeConfigOpenPage } from '../runtime-config/runtime-config-navigation-events';
import { useDesktopModelConfigProfileController } from '../runtime-config/desktop-model-config-profile-controller';
import { getDesktopRouteModelPickerProvider } from '../runtime-config/desktop-route-model-picker-provider';
import { useLocalAssets } from '../chat/capability-settings-shared';
import { SettingsSummaryCard } from '../chat/chat-shared-settings-summary-card';
import { TESTER_AI_SCOPE_REF, bindingFromTesterConfig } from './tester-ai-config';
import { CAPABILITIES, type CapabilityId } from './tester-types.js';

export type TesterSettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  config: AIConfig;
  onBindingChange: (capabilityId: CapabilityId, binding: RuntimeRouteBinding | null) => void;
  onParamsChange: (capabilityId: CapabilityId, params: Record<string, unknown>) => void;
};

type EditorKind = 'image' | 'video';

type ModuleDescriptor = {
  id: string;
  capabilityId: CapabilityId;
  routeCapability: string;
  labelKey: string;
  defaultLabel: string;
  editorKind?: EditorKind;
};

const MODULE_DESCRIPTORS: ModuleDescriptor[] = [
  { id: 'chat', capabilityId: 'text.generate', routeCapability: 'text.generate', labelKey: 'Tester.capability.chat', defaultLabel: 'Chat' },
  { id: 'embed', capabilityId: 'text.embed', routeCapability: 'text.embed', labelKey: 'Tester.capability.embed', defaultLabel: 'Embed' },
  { id: 'image', capabilityId: 'image.generate', routeCapability: 'image.generate', labelKey: 'Tester.capability.image', defaultLabel: 'Image', editorKind: 'image' },
  { id: 'video', capabilityId: 'video.generate', routeCapability: 'video.generate', labelKey: 'Tester.capability.video', defaultLabel: 'Video', editorKind: 'video' },
  { id: 'tts', capabilityId: 'audio.synthesize', routeCapability: 'audio.synthesize', labelKey: 'Tester.capability.tts', defaultLabel: 'TTS' },
  { id: 'stt', capabilityId: 'audio.transcribe', routeCapability: 'audio.transcribe', labelKey: 'Tester.capability.stt', defaultLabel: 'STT' },
  { id: 'voice-clone', capabilityId: 'voice.clone', routeCapability: 'voice_workflow.tts_v2v', labelKey: 'Tester.capability.voiceClone', defaultLabel: 'Voice Clone' },
  { id: 'voice-design', capabilityId: 'voice.design', routeCapability: 'voice_workflow.tts_t2v', labelKey: 'Tester.capability.voiceDesign', defaultLabel: 'Voice Design' },
  { id: 'world', capabilityId: 'world.generate', routeCapability: 'world.generate', labelKey: 'Tester.capability.worldTour', defaultLabel: 'World Tour' },
];

function createProfileCopy(t: ReturnType<typeof useTranslation>['t']): ModelConfigProfileCopy {
  return {
    sectionTitle: 'Profile',
    summaryLabel: t('Chat.settingsAIProfileTitle', { defaultValue: 'AI Profile' }),
    emptySummaryLabel: t('Chat.settingsAIProfileNone', { defaultValue: 'No profile applied' }),
    applyButtonLabel: t('Chat.settingsAIProfileApplyBtn', { defaultValue: 'Apply profile' }),
    changeButtonLabel: t('Chat.settingsAIProfileChange', { defaultValue: 'Change' }),
    manageButtonTitle: t('Chat.settingsAIProfileManage', { defaultValue: 'Manage profiles' }),
    modalTitle: t('Chat.settingsAIProfileModalTitle', { defaultValue: 'Apply AI Profile' }),
    modalHint: t('Chat.settingsAIProfileModalHint', {
      defaultValue: 'Selecting a profile will overwrite all current capability bindings (Chat, TTS, Image, Video). This action cannot be undone.',
    }),
    loadingLabel: t('Chat.settingsLoading', { defaultValue: 'Loading profiles...' }),
    emptyLabel: t('Chat.settingsAIProfileEmpty', { defaultValue: 'No profiles available.' }),
    currentBadgeLabel: t('Chat.settingsAIProfileCurrent', { defaultValue: 'Current' }),
    cancelLabel: t('Chat.settingsAIProfileCancel', { defaultValue: 'Cancel' }),
    confirmLabel: t('Chat.settingsAIProfileConfirm', { defaultValue: 'Confirm & Apply' }),
    applyingLabel: t('Chat.settingsAIProfileApplying', { defaultValue: 'Applying...' }),
    importLabel: t('Chat.settingsAIProfileImport', { defaultValue: 'Import AI Profile' }),
    reloadLabel: t('Tester.profile.reload', { defaultValue: 'Reload' }),
  };
}

function createImageEditorCopy(t: ReturnType<typeof useTranslation>['t']): ImageParamsEditorCopy {
  return {
    companionModelsLabel: t('Chat.imageCompanionModels', { defaultValue: 'Companion Models' }),
    parametersLabel: t('Chat.imageParameters', { defaultValue: 'Parameters' }),
    previewBadgeLabel: t('Chat.badgePreview', { defaultValue: 'Preview' }),
    sizeLabel: t('Chat.imageParamSize', { defaultValue: 'Size' }),
    responseFormatLabel: t('Chat.imageParamResponseFormat', { defaultValue: 'Response format' }),
    seedLabel: t('Chat.imageParamSeed', { defaultValue: 'Seed' }),
    seedHint: t('Chat.imageParamSeedHint', { defaultValue: 'Optional seed for reproducibility' }),
    timeoutLabel: t('Chat.imageParamTimeout', { defaultValue: 'Timeout (ms)' }),
    stepsLabel: t('Chat.imageParamSteps', { defaultValue: 'Steps' }),
    cfgScaleLabel: t('Chat.imageParamCfgScale', { defaultValue: 'CFG Scale' }),
    samplerLabel: t('Chat.imageParamSampler', { defaultValue: 'Sampler' }),
    schedulerLabel: t('Chat.imageParamScheduler', { defaultValue: 'Scheduler' }),
    customOptionsLabel: t('Chat.imageParamCustomOptions', { defaultValue: 'Custom options' }),
    customOptionsHint: t('Chat.imageParamCustomOptionsHint', { defaultValue: 'One option per line. Example: diffusion_model' }),
    defaultPlaceholder: t('Chat.placeholderDefault', { defaultValue: 'Default' }),
    randomPlaceholder: t('Chat.placeholderRandom', { defaultValue: 'Random' }),
    oneOptionPerLinePlaceholder: t('Chat.placeholderOnePerLine', { defaultValue: 'One option per line' }),
    noneLabel: t('Chat.companionSlotNone', { defaultValue: 'None' }),
  };
}

function createVideoEditorCopy(t: ReturnType<typeof useTranslation>['t']): VideoParamsEditorCopy {
  return {
    parametersLabel: t('Chat.videoParameters', { defaultValue: 'Parameters' }),
    previewBadgeLabel: t('Chat.badgePreview', { defaultValue: 'Preview' }),
    modeLabel: t('Chat.videoParamMode', { defaultValue: 'Mode' }),
    ratioLabel: t('Chat.videoParamRatio', { defaultValue: 'Aspect ratio' }),
    durationLabel: t('Chat.videoParamDuration', { defaultValue: 'Duration (sec)' }),
    durationHint: t('Chat.videoParamDurationHint', { defaultValue: 'Range: 1–11 seconds' }),
    resolutionLabel: t('Chat.videoParamResolution', { defaultValue: 'Resolution' }),
    fpsLabel: t('Chat.videoParamFps', { defaultValue: 'FPS' }),
    seedLabel: t('Chat.videoParamSeed', { defaultValue: 'Seed' }),
    seedHint: t('Chat.videoParamSeedHint', { defaultValue: 'Optional seed for reproducibility' }),
    timeoutLabel: t('Chat.videoParamTimeout', { defaultValue: 'Timeout (ms)' }),
    cameraFixedLabel: t('Chat.videoParamCameraFixed', { defaultValue: 'Fixed camera' }),
    generateAudioLabel: t('Chat.videoParamGenerateAudio', { defaultValue: 'Generate audio' }),
    defaultPlaceholder: t('Chat.placeholderDefault', { defaultValue: 'Default' }),
    randomPlaceholder: t('Chat.placeholderRandom', { defaultValue: 'Random' }),
    modeOptions: [
      { value: 't2v', label: t('Chat.videoModeT2v', { defaultValue: 'Text to Video' }) },
      { value: 'i2v-first-frame', label: t('Chat.videoModeI2vFirst', { defaultValue: 'Image to Video (first frame)' }) },
      { value: 'i2v-reference', label: t('Chat.videoModeI2vRef', { defaultValue: 'Image to Video (reference)' }) },
    ],
  };
}

function useCapabilityProviders(): Record<string, RouteModelPickerDataProvider | null> {
  return useMemo(() => {
    const providers: Record<string, RouteModelPickerDataProvider | null> = {};
    for (const capability of CAPABILITIES) {
      if (!capability.hasRoute || !capability.routeCapability || providers[capability.routeCapability] !== undefined) {
        continue;
      }
      providers[capability.routeCapability] = getDesktopRouteModelPickerProvider(capability.routeCapability);
    }
    return providers;
  }, []);
}

function DetailHeader(props: { title: string; onBack: () => void; backLabel: string }) {
  return (
    <div className="mb-5 flex items-center gap-2.5">
      <button
        type="button"
        onClick={props.onBack}
        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-white text-[var(--nimi-text-muted)] transition-all hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)] hover:text-[var(--nimi-action-primary-bg)]"
        aria-label={props.backLabel}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</h2>
    </div>
  );
}

export function TesterSettingsPanel(props: TesterSettingsPanelProps) {
  const { open, onClose, config, onBindingChange, onParamsChange } = props;
  const { t } = useTranslation();
  const providers = useCapabilityProviders();
  const assetsQuery = useLocalAssets();
  const assets = assetsQuery.data || [];
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const imageEditorCopy = useMemo(() => createImageEditorCopy(t), [t]);
  const videoEditorCopy = useMemo(() => createVideoEditorCopy(t), [t]);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);

  const profile = useDesktopModelConfigProfileController({
    scopeRef: TESTER_AI_SCOPE_REF,
    currentOrigin: config.profileOrigin
      ? { profileId: config.profileOrigin.profileId, title: config.profileOrigin.title }
      : null,
    copy: createProfileCopy(t),
    onManage: () => {
      setActiveTab('runtime');
      setTimeout(() => dispatchRuntimeConfigOpenPage('profiles'), 100);
    },
  });

  const modules = useMemo(() => {
    return MODULE_DESCRIPTORS.map((descriptor): {
      descriptor: ModuleDescriptor;
      label: string;
      item: ModelConfigCapabilityItem;
    } => {
      const label = t(descriptor.labelKey, { defaultValue: descriptor.defaultLabel });
      const binding = bindingFromTesterConfig(config, descriptor.capabilityId);
      const storedParams = (config.capabilities.selectedParams[descriptor.capabilityId] || {}) as Record<string, unknown>;

      let editor: ReactNode | undefined;
      if (descriptor.editorKind === 'image') {
        const imageParams = parseImageParams(storedParams);
        const companionSlots = (storedParams.companionSlots || {}) as Record<string, string>;
        editor = (
          <ImageParamsEditor
            copy={imageEditorCopy}
            params={imageParams}
            companionSlots={companionSlots}
            assets={assets}
            assetsLoading={assetsQuery.isLoading}
            onParamsChange={(next) => onParamsChange('image.generate', { ...next, companionSlots })}
            onCompanionSlotsChange={(next) => onParamsChange('image.generate', { ...imageParams, companionSlots: next })}
          />
        );
      } else if (descriptor.editorKind === 'video') {
        const videoParams = parseVideoParams(storedParams);
        editor = (
          <VideoParamsEditor
            copy={videoEditorCopy}
            params={videoParams}
            onParamsChange={(next) => onParamsChange('video.generate', next as unknown as Record<string, unknown>)}
          />
        );
      }

      const item: ModelConfigCapabilityItem = {
        capabilityId: descriptor.capabilityId,
        routeCapability: descriptor.routeCapability,
        label,
        binding,
        provider: providers[descriptor.routeCapability] || null,
        onBindingChange: (next) => onBindingChange(descriptor.capabilityId, next),
        placeholder: t('Chat.settingsSelectModel', { defaultValue: 'Select a model' }),
        runtimeNotReadyLabel: t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
        editor,
        showEditorWhen: descriptor.editorKind ? 'local' : 'always',
      };

      return { descriptor, label, item };
    });
  }, [assets, assetsQuery.isLoading, config, imageEditorCopy, onBindingChange, onParamsChange, providers, t, videoEditorCopy]);

  if (!open) {
    return null;
  }

  const activeModule = activeModuleId ? modules.find((m) => m.descriptor.id === activeModuleId) : null;
  const backLabel = t('Chat.settingsBack', { defaultValue: 'Back' });

  return (
    <aside
      className="mr-2 flex min-h-0 w-[400px] shrink-0 flex-col"
      data-right-panel="tester-settings"
    >
      <DesktopCardSurface
        kind="promoted-glass"
        as="section"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {/* Header: title + subtitle + close button */}
        <div className="flex items-start gap-3 border-b border-white/70 px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('Tester.settings.title', { defaultValue: 'AI Tester Settings' })}
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">
              {t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' })}
            </p>
          </div>
          <DesktopIconToggleAction
            icon={(
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            aria-label={t('Chat.closePanel', { defaultValue: 'Close panel' })}
            title={t('Chat.closePanel', { defaultValue: 'Close panel' })}
            onClick={onClose}
          />
        </div>

        <ScrollArea className={cn('min-h-0 flex-1')}>
          <div className="px-3 py-3">
            {activeModule ? (
              <div className="space-y-5">
                <div className="animate-in slide-in-from-right-4 duration-200">
                  <DetailHeader
                    title={activeModule.label}
                    onBack={() => setActiveModuleId(null)}
                    backLabel={backLabel}
                  />
                  <CapabilityModelCard item={activeModule.item} />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {/* AI Profile import button */}
                {profile ? (
                  <div key="profile">
                    <ProfileConfigSection controller={profile} variant="import-button" />
                  </div>
                ) : null}

                {/* Divider + Section Label */}
                <div className="mb-3 border-t border-slate-100 px-6 pt-5">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    {t('Chat.modelCapabilitiesLabel', { defaultValue: 'Model Capabilities' })}
                  </h3>
                </div>

                {/* Capability Summary Cards */}
                {modules.map(({ descriptor, label, item }) => {
                  const subtitle = item.binding?.modelLabel || item.binding?.model || null;
                  const sourceBadge = item.binding?.source ?? null;
                  return (
                    <SettingsSummaryCard
                      key={descriptor.id}
                      title={label}
                      subtitle={subtitle}
                      statusDot="neutral"
                      statusLabel={null}
                      sourceBadge={sourceBadge}
                      onClick={() => setActiveModuleId(descriptor.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </DesktopCardSurface>
    </aside>
  );
}
