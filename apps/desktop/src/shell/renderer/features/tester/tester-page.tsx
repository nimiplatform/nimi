import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig, RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import { ScrollArea, IconButton, Surface } from '@nimiplatform/nimi-kit/ui';
import {
  SidebarAffordanceChevron,
  SidebarHeader,
  SidebarItem,
  SidebarResizeHandle,
  SidebarSection,
  SidebarShell,
} from '@renderer/components/sidebar.js';
import { RuntimePageShell } from '../runtime-config/runtime-config-page-shell';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  type CapabilityId,
  type CapabilityState,
  type ImageWorkflowDraftState,
} from './tester-types.js';
import { loadRouteSnapshot, makeInitialCapabilityStates } from './tester-state.js';
import { TesterSettingsPanel } from './tester-settings-dialog.js';
import { TextGeneratePanel } from './panels/panel-text-generate.js';
import { TextEmbedPanel } from './panels/panel-text-embed.js';
import { ImageGeneratePanel } from './panels/panel-image-generate.js';
import { VideoGeneratePanel } from './panels/panel-video-generate.js';
import { WorldTourPanel } from './panels/panel-world-tour.js';
import { AudioSynthesizePanel } from './panels/panel-audio-synthesize.js';
import { AudioTranscribePanel } from './panels/panel-audio-transcribe.js';
import { TextStreamPanel } from './panels/panel-text-stream.js';
import { VoiceClonePanel, VoiceDesignPanel } from './panels/panel-voice-stubs.js';
import { TESTER_AI_SCOPE_REF, bindingFromTesterConfig, bootstrapTesterAIConfigScope, createEmptyTesterAIConfig } from './tester-ai-config';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { CAP_META } from './tester-cap-meta.js';
import { CapTile, SourceChip } from './tester-visuals.js';
import { TesterHistoryPanel } from './tester-history-panel.js';
import { useTesterHistory } from './tester-history.js';

const SIDEBAR_GROUPS: Array<{ label: string; ids: CapabilityId[] }> = [
  { label: 'Text', ids: ['text.generate', 'text.stream', 'text.embed'] },
  { label: 'Media', ids: ['image.generate', 'image.create-job', 'video.create-job'] },
  { label: 'World', ids: ['world.generate'] },
  { label: 'Audio', ids: ['audio.synthesize', 'audio.transcribe', 'voice_workflow.tts_v2v', 'voice_workflow.tts_t2v'] },
];

const SETTINGS_GEAR_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);


function createInitialImageWorkflowDraftState(): ImageWorkflowDraftState {
  return {
    prompt: 'A cat wearing a top hat in a field of flowers.',
    negativePrompt: '',
    size: '1024x1024',
    n: '1',
    seed: '',
    responseFormatMode: 'auto',
    timeoutMs: '',
    step: '',
    cfgScale: '',
    sampler: '',
    scheduler: '',
    optionsText: '',
    rawProfileOverridesText: '',
    vaeModel: '',
    llmModel: '',
    clipLModel: '',
    clipGModel: '',
    controlnetModel: '',
    loraModel: '',
    auxiliaryModel: '',
    componentDrafts: [],
  };
}

function imageConfigParamsFromDraft(draft: ImageWorkflowDraftState): Record<string, unknown> {
  return {
    size: draft.size,
    responseFormat: draft.responseFormatMode,
    seed: draft.seed,
    timeoutMs: draft.timeoutMs,
    steps: draft.step,
    cfgScale: draft.cfgScale,
    sampler: draft.sampler,
    scheduler: draft.scheduler,
    optionsText: draft.optionsText,
    companionSlots: {
      vae_path: draft.vaeModel,
      llm_path: draft.llmModel,
      clip_l_path: draft.clipLModel,
      clip_g_path: draft.clipGModel,
      controlnet_path: draft.controlnetModel,
      lora_path: draft.loraModel,
      aux_path: draft.auxiliaryModel,
    },
  };
}

function applyImageConfigToDraft(draft: ImageWorkflowDraftState, config: AIConfig): ImageWorkflowDraftState {
  const stored = (config.capabilities.selectedParams['image.generate'] || {}) as Record<string, unknown>;
  const companionSlots = (stored.companionSlots || {}) as Record<string, string>;
  return {
    ...draft,
    size: typeof stored.size === 'string' ? stored.size : draft.size,
    responseFormatMode: typeof stored.responseFormat === 'string' ? stored.responseFormat as ImageWorkflowDraftState['responseFormatMode'] : draft.responseFormatMode,
    seed: typeof stored.seed === 'string' ? stored.seed : draft.seed,
    timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : draft.timeoutMs,
    step: typeof stored.steps === 'string' ? stored.steps : draft.step,
    cfgScale: typeof stored.cfgScale === 'string' ? stored.cfgScale : draft.cfgScale,
    sampler: typeof stored.sampler === 'string' ? stored.sampler : draft.sampler,
    scheduler: typeof stored.scheduler === 'string' ? stored.scheduler : draft.scheduler,
    optionsText: typeof stored.optionsText === 'string' ? stored.optionsText : draft.optionsText,
    vaeModel: companionSlots.vae_path || '',
    llmModel: companionSlots.llm_path || '',
    clipLModel: companionSlots.clip_l_path || '',
    clipGModel: companionSlots.clip_g_path || '',
    controlnetModel: companionSlots.controlnet_path || '',
    loraModel: companionSlots.lora_path || '',
    auxiliaryModel: companionSlots.aux_path || '',
  };
}

function videoParamsFromConfig(config: AIConfig) {
  const stored = (config.capabilities.selectedParams['video.generate'] || {}) as Record<string, unknown>;
  return {
    mode: typeof stored.mode === 'string' ? stored.mode : 't2v',
    ratio: typeof stored.ratio === 'string' ? stored.ratio : '16:9',
    durationSec: typeof stored.durationSec === 'string' ? stored.durationSec : '5',
    resolution: typeof stored.resolution === 'string' ? stored.resolution : '',
    fps: typeof stored.fps === 'string' ? stored.fps : '',
    seed: typeof stored.seed === 'string' ? stored.seed : '',
    timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : '',
    negativePrompt: typeof stored.negativePrompt === 'string' ? stored.negativePrompt : '',
    cameraFixed: typeof stored.cameraFixed === 'boolean' ? stored.cameraFixed : false,
    generateAudio: typeof stored.generateAudio === 'boolean' ? stored.generateAudio : false,
  };
}

function mergeBindingIntoState(state: CapabilityState, binding: RuntimeRouteBinding | null): CapabilityState {
  return { ...state, binding };
}

export function TesterPage() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const aiConfigSurface = useMemo(() => getDesktopAIConfigService(), []);
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const [activeCapability, setActiveCapability] = useState<CapabilityId>('text.generate');
  const [states, setStates] = useState(makeInitialCapabilityStates);
  const [imageDraft, setImageDraft] = useState<ImageWorkflowDraftState>(createInitialImageWorkflowDraftState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testerConfig, setTesterConfig] = useState<AIConfig>(() => {
    try {
      return bootstrapTesterAIConfigScope(aiConfigSurface);
    } catch {
      return createEmptyTesterAIConfig();
    }
  });

  useEffect(() => {
    setTesterConfig(bootstrapTesterAIConfigScope(aiConfigSurface));
    return aiConfigSurface.aiConfig.subscribe(TESTER_AI_SCOPE_REF, (config) => {
      setTesterConfig(config);
    });
  }, [aiConfigSurface]);

  useEffect(() => {
    setImageDraft((prev) => applyImageConfigToDraft(prev, testerConfig));
  }, [testerConfig]);

  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const next = Math.min(420, Math.max(200, Math.round(event.clientX - rect.left)));
      setSidebarWidth(next);
    };
    const onMouseUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const updateCapabilityState = useCallback((capabilityId: CapabilityId, updater: (prev: CapabilityState) => CapabilityState) => {
    setStates((prev) => ({ ...prev, [capabilityId]: updater(prev[capabilityId]) }));
  }, []);

  const persistTesterConfig = useCallback((updater: (current: AIConfig) => AIConfig) => {
    const current = aiConfigSurface.aiConfig.get(TESTER_AI_SCOPE_REF);
    const next = updater(current);
    aiConfigSurface.aiConfig.update(TESTER_AI_SCOPE_REF, next);
  }, [aiConfigSurface]);

  const handleSettingsParamsChange = useCallback((capabilityId: CapabilityId, params: Record<string, unknown>) => {
    persistTesterConfig((current) => ({
      ...current,
      capabilities: {
        ...current.capabilities,
        selectedParams: {
          ...current.capabilities.selectedParams,
          [capabilityId]: params,
        },
      },
    }));
  }, [persistTesterConfig]);

  const handleImageDraftChange = useCallback((updater: React.SetStateAction<ImageWorkflowDraftState>) => {
    setImageDraft((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      handleSettingsParamsChange('image.generate', imageConfigParamsFromDraft(next));
      return next;
    });
  }, [handleSettingsParamsChange]);

  useEffect(() => {
    const loadedCapabilities = new Set<string>();
    for (const capability of CAPABILITIES) {
      if (!capability.hasRoute || !capability.routeCapability || loadedCapabilities.has(capability.routeCapability)) {
        continue;
      }
      loadedCapabilities.add(capability.routeCapability);
      void loadRouteSnapshot({ capabilityId: capability.id, setStates });
    }
  }, []);

  const activeState = useMemo(
    () => mergeBindingIntoState(states[activeCapability], bindingFromTesterConfig(testerConfig, activeCapability)),
    [activeCapability, states, testerConfig],
  );
  const activeLabels = CAPABILITY_LABELS[activeCapability];
  const currentVideoParams = useMemo(() => videoParamsFromConfig(testerConfig), [testerConfig]);
  const { history, clearCapability, removeEntry } = useTesterHistory(states);
  const activeHistory = history[activeCapability] ?? [];
  const activeMeta = CAP_META[activeCapability];
  const activeBinding = activeState.binding;
  const activeSource = activeBinding?.source === 'local' || activeBinding?.source === 'cloud'
    ? (activeBinding.source as 'local' | 'cloud')
    : null;
  const activeModelId = activeBinding?.model || activeBinding?.modelId || activeBinding?.connectorId || undefined;
  const lastRun = activeHistory[0];
  const activeLatency = lastRun?.elapsedMs ?? null;

  const renderPanel = () => {
    switch (activeCapability) {
      case 'text.generate':
        return (
          <TextGeneratePanel
            state={activeState}
            onStateChange={(updater) => updateCapabilityState('text.generate', updater)}
          />
        );
      case 'text.stream':
        return (
          <TextStreamPanel
            state={activeState}
            onStateChange={(updater) => updateCapabilityState('text.stream', updater)}
          />
        );
      case 'text.embed':
        return (
          <TextEmbedPanel
            state={activeState}
            onStateChange={(updater) => updateCapabilityState('text.embed', updater)}
          />
        );
      case 'image.generate':
        return (
          <ImageGeneratePanel
            mode="generate"
            state={activeState}
            draft={imageDraft}
            onDraftChange={handleImageDraftChange}
            onStateChange={(updater) => updateCapabilityState('image.generate', updater)}
          />
        );
      case 'image.create-job':
        return (
          <ImageGeneratePanel
            mode="job"
            state={mergeBindingIntoState(states['image.create-job'], bindingFromTesterConfig(testerConfig, 'image.generate'))}
            draft={imageDraft}
            onDraftChange={handleImageDraftChange}
            onStateChange={(updater) => updateCapabilityState('image.create-job', updater)}
          />
        );
      case 'video.create-job':
      case 'video.generate':
        return (
          <VideoGeneratePanel
            mode="job"
            state={mergeBindingIntoState(states[activeCapability], bindingFromTesterConfig(testerConfig, 'video.generate'))}
            params={currentVideoParams}
            onParamsChange={(next) => handleSettingsParamsChange('video.generate', next as unknown as Record<string, unknown>)}
            onStateChange={(updater) => updateCapabilityState(activeCapability, updater)}
          />
        );
      case 'world.generate':
        return (
          <WorldTourPanel
            state={activeState}
            onStateChange={(updater) => updateCapabilityState('world.generate', updater)}
          />
        );
      case 'audio.synthesize':
        return (
          <AudioSynthesizePanel
            state={activeState}
            onStateChange={(updater) => updateCapabilityState('audio.synthesize', updater)}
          />
        );
      case 'audio.transcribe':
        return (
          <AudioTranscribePanel
            state={activeState}
            onStateChange={(updater) => updateCapabilityState('audio.transcribe', updater)}
          />
        );
      case 'voice_workflow.tts_v2v':
        return (
          <VoiceClonePanel
            state={activeState}
            onStateChange={(updater) => updateCapabilityState('voice_workflow.tts_v2v', updater)}
          />
        );
      case 'voice_workflow.tts_t2v':
        return (
          <VoiceDesignPanel
            state={activeState}
            onStateChange={(updater) => updateCapabilityState('voice_workflow.tts_t2v', updater)}
          />
        );
    }
  };

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 gap-4 px-5 pb-5 pt-4">
      <SidebarShell width={sidebarWidth}>
        <SidebarHeader title={<h1 className="nimi-type-page-title text-[color:var(--nimi-text-primary)]">{t('Tester.title', { defaultValue: 'Tester' })}</h1>} className="px-5" />
        <ScrollArea className="flex-1" contentClassName="px-3 pb-3 pt-2">
          <div className="space-y-5">
            {SIDEBAR_GROUPS.map((group) => (
              <SidebarSection key={group.label} label={group.label}>
                {CAPABILITIES.filter((c) => group.ids.includes(c.id)).map((capability) => {
                  const labels = CAPABILITY_LABELS[capability.id];
                  const isActive = activeCapability === capability.id;
                  return (
                    <div
                      key={capability.id}
                      data-testid={E2E_IDS.testerCapabilityTab(capability.id)}
                      onClick={() => setActiveCapability(capability.id)}
                    >
                      <SidebarItem
                        kind="nav-row"
                        active={isActive}
                        onClick={() => setActiveCapability(capability.id)}
                        label={labels.label}
                        trailing={isActive ? <SidebarAffordanceChevron /> : undefined}
                      />
                    </div>
                  );
                })}
              </SidebarSection>
            ))}
          </div>
        </ScrollArea>
        <SidebarResizeHandle ariaLabel="Resize sidebar" onMouseDown={startResize} />
      </SidebarShell>

      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[2rem] border-white/60 shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
      >
        <ScrollArea className="flex-1" viewportClassName="bg-transparent">
          <RuntimePageShell maxWidth="5xl">
            <div className="tester-page-hero">
              {activeMeta ? <CapTile kind={activeMeta.icon} tone={activeMeta.tone} size={52} /> : null}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="tester-cap-title">{activeLabels.label}</div>
                <div className="tester-cap-sub">{activeLabels.description}</div>
                <div style={{ marginTop: 12 }}>
                  <SourceChip
                    source={activeSource}
                    id={activeModelId}
                    latencyMs={activeLatency}
                    cost={null}
                  />
                </div>
              </div>
              <IconButton
                icon={SETTINGS_GEAR_ICON}
                onClick={() => setSettingsOpen((prev) => !prev)}
                aria-label={t('Tester.openSettings', { defaultValue: 'Settings' })}
              />
            </div>

            {renderPanel()}

            <TesterHistoryPanel
              capabilityLabel={activeLabels.label}
              entries={activeHistory}
              onClear={() => clearCapability(activeCapability)}
              onRemoveEntry={(entryId) => removeEntry(activeCapability, entryId)}
            />
          </RuntimePageShell>
        </ScrollArea>
      </Surface>

      <TesterSettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={testerConfig}
      />
    </div>
  );
}
