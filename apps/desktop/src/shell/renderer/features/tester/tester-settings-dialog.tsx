import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '@nimiplatform/sdk/mod';
import {
  ModelConfigCapabilityDetail,
  ProfileConfigSection,
  SectionGroupHeader,
} from '@nimiplatform/nimi-kit/features/model-config';
import {
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
  type CanonicalCapabilityDescriptor,
  type CanonicalCapabilitySectionId,
} from '@nimiplatform/nimi-kit/core/runtime-capabilities';
import {
  selectEnabledDescriptors,
  summarizeAiModelAggregate,
  type AppModelConfigSurface,
  type CapabilityEvaluation,
  type ModelConfigStatusTone,
} from '@nimiplatform/nimi-kit/core/model-config';
import type { ModelConfigProfileController } from '@nimiplatform/nimi-kit/features/model-config';
import { ScrollArea, Surface, cn } from '@nimiplatform/nimi-kit/ui';
import { DesktopIconToggleAction } from '@renderer/components/action';
import { useTesterModelConfigController } from './tester-model-config-hook';
import type { CapabilityState, ImageWorkflowDraftState } from './tester-types.js';
import { TesterChatSectionBody } from './panels/panel-chat-settings.js';
import { TesterImageSectionBody } from './panels/panel-image-settings.js';
import { TesterVideoSectionBody } from './panels/panel-video-settings.js';
import type { VideoParamsState } from '@nimiplatform/nimi-kit/features/model-config';

const SECTION_ORDER: ReadonlyArray<CanonicalCapabilitySectionId> = [
  'chat',
  'tts',
  'stt',
  'image',
  'video',
  'voice',
  'embed',
  'world',
];

export type TesterImageSectionContext = {
  state: CapabilityState;
  draft: ImageWorkflowDraftState;
  onDraftChange: React.Dispatch<React.SetStateAction<ImageWorkflowDraftState>>;
};

export type TesterVideoSectionContext = {
  params: VideoParamsState;
  onParamsChange: (next: VideoParamsState) => void;
};

export type TesterSettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  config: AIConfig;
  initialSection?: CanonicalCapabilitySectionId | null;
  imageContext?: TesterImageSectionContext;
  videoContext?: TesterVideoSectionContext;
};

const CLOSE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const BACK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 19l-7-7 7-7" />
  </svg>
);

const FORWARD_CHEVRON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

function statusDotClass(tone: ModelConfigStatusTone): string {
  if (tone === 'attention') return 'bg-amber-400';
  if (tone === 'ready') return 'bg-emerald-400';
  return 'bg-slate-300';
}

function groupBySection(
  descriptors: ReadonlyArray<CanonicalCapabilityDescriptor>,
): Map<CanonicalCapabilitySectionId, CanonicalCapabilityDescriptor[]> {
  const map = new Map<CanonicalCapabilitySectionId, CanonicalCapabilityDescriptor[]>();
  for (const d of descriptors) {
    const list = map.get(d.section) ?? [];
    list.push(d);
    map.set(d.section, list);
  }
  return map;
}

function useLiveConfig(surface: AppModelConfigSurface, fallback: AIConfig): AIConfig {
  const [cfg, setCfg] = React.useState<AIConfig>(() => surface.aiConfigService.aiConfig.get(surface.scopeRef) || fallback);
  React.useEffect(() => {
    setCfg(surface.aiConfigService.aiConfig.get(surface.scopeRef) || fallback);
    return surface.aiConfigService.aiConfig.subscribe(surface.scopeRef, (next) => setCfg(next));
  }, [surface.aiConfigService, surface.scopeRef, fallback]);
  return cfg;
}

type SectionListProps = {
  surface: AppModelConfigSurface;
  config: AIConfig;
  onSelect: (section: CanonicalCapabilitySectionId) => void;
  profile: ModelConfigProfileController;
};

function SectionList({ surface, config, onSelect, profile }: SectionListProps) {
  const t = surface.i18n.t;
  const descriptors = React.useMemo(
    () => selectEnabledDescriptors(surface.enabledCapabilities, CANONICAL_CAPABILITY_CATALOG_BY_ID),
    [surface.enabledCapabilities],
  );
  const sectionMap = React.useMemo(() => groupBySection(descriptors), [descriptors]);
  const orderedSections = React.useMemo(
    () => SECTION_ORDER.filter((s) => sectionMap.has(s)),
    [sectionMap],
  );
  const evaluations: ReadonlyArray<CapabilityEvaluation> = React.useMemo(() => {
    const out: CapabilityEvaluation[] = [];
    for (const d of descriptors) {
      out.push({
        capabilityId: d.capabilityId,
        descriptor: d,
        status: surface.projectionResolver(d.capabilityId),
        bindingPresent: Boolean(config.capabilities.selectedBindings?.[d.capabilityId]),
      });
    }
    return out;
  }, [descriptors, config, surface]);

  return (
    <div className="space-y-3">
      <div>
        <ProfileConfigSection controller={profile} variant="import-button" />
      </div>
      <div className="space-y-2">
        {orderedSections.map((section) => {
          const sectionEvaluations = evaluations.filter((e) => e.descriptor.section === section);
          const sectionAggregate = summarizeAiModelAggregate(sectionEvaluations, {
            ready: t('ModelConfig.hub.aggregateReady'),
            attention: t('ModelConfig.hub.aggregateAttention'),
            neutral: t('ModelConfig.hub.aggregateNeutral'),
          });
          const items = sectionMap.get(section) ?? [];
          const firstDescriptor = items[0];
          return (
            <button
              key={section}
              type="button"
              onClick={() => onSelect(section)}
              className="flex w-full items-center justify-between gap-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 text-left transition-colors hover:border-[var(--nimi-border-strong)]"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--nimi-text-primary)]">
                  {t(`ModelConfig.section.${section}.title`)}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--nimi-text-muted)]">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(sectionAggregate.statusDot)}`} />
                  <span className="truncate">
                    {sectionAggregate.subtitle || (firstDescriptor ? t(firstDescriptor.i18nKeys.subtitle) : '')}
                  </span>
                </div>
              </div>
              <span className="shrink-0 text-[var(--nimi-text-muted)]">{FORWARD_CHEVRON}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type SectionDetailProps = {
  section: CanonicalCapabilitySectionId;
  surface: AppModelConfigSurface;
  config: AIConfig;
  imageContext?: TesterImageSectionContext;
  videoContext?: TesterVideoSectionContext;
};

function SectionDetail({ section, surface, config, imageContext, videoContext }: SectionDetailProps) {
  const t = surface.i18n.t;
  const descriptors = React.useMemo(
    () => selectEnabledDescriptors(surface.enabledCapabilities, CANONICAL_CAPABILITY_CATALOG_BY_ID),
    [surface.enabledCapabilities],
  );
  const sectionDescriptors = React.useMemo(
    () => descriptors.filter((d) => d.section === section),
    [descriptors, section],
  );

  if (section === 'image' && imageContext) {
    return (
      <TesterImageSectionBody
        state={imageContext.state}
        draft={imageContext.draft}
        onDraftChange={imageContext.onDraftChange}
        surface={surface}
        config={config}
      />
    );
  }

  if (section === 'video' && videoContext) {
    return (
      <TesterVideoSectionBody
        params={videoContext.params}
        onParamsChange={videoContext.onParamsChange}
        surface={surface}
        config={config}
      />
    );
  }

  if (section === 'chat') {
    return <TesterChatSectionBody surface={surface} config={config} />;
  }

  const generalLabel = t('Tester.settings.generalGroup', { defaultValue: 'General' });

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionGroupHeader label={generalLabel} />
        <div className="space-y-4">
          {sectionDescriptors.map((d) => (
            <ModelConfigCapabilityDetail
              key={d.capabilityId}
              capabilityId={d.capabilityId}
              surface={surface}
              config={config}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function clearSectionParams(
  surface: AppModelConfigSurface,
  capabilityIds: ReadonlyArray<string>,
): void {
  const service = surface.aiConfigService;
  const current = service.aiConfig.get(surface.scopeRef);
  const nextParams = { ...current.capabilities.selectedParams };
  for (const id of capabilityIds) {
    delete nextParams[id];
  }
  service.aiConfig.update(surface.scopeRef, {
    ...current,
    capabilities: {
      ...current.capabilities,
      selectedParams: nextParams,
    },
  });
}

export function TesterSettingsPanel(props: TesterSettingsPanelProps) {
  const { open, onClose, config, initialSection, imageContext, videoContext } = props;
  const { t } = useTranslation();
  const { surface, profile } = useTesterModelConfigController(config);
  const liveConfig = useLiveConfig(surface, config);
  const [activeSection, setActiveSection] = React.useState<CanonicalCapabilitySectionId | null>(initialSection ?? null);

  React.useEffect(() => {
    if (!open) return;
    setActiveSection(initialSection ?? null);
  }, [open, initialSection]);

  React.useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (activeSection !== null) {
          setActiveSection(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose, activeSection]);

  if (!open) {
    return null;
  }

  const inDetail = activeSection !== null;
  const headerTitle = inDetail
    ? t(`ModelConfig.section.${activeSection}.title`)
    : t('Tester.settings.title', { defaultValue: 'AI Tester Settings' });
  const headerSubtitle = inDetail
    ? t('Tester.settings.detailSubtitle', { defaultValue: 'Configure models and defaults' })
    : t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' });
  const showBack = inDetail;

  return (
    <Surface
      as="aside"
      tone="panel"
      material="glass-regular"
      padding="none"
      role="dialog"
      aria-modal="false"
      aria-label={t('Tester.settings.title', { defaultValue: 'AI Tester Settings' })}
      data-right-panel="tester-settings"
      className="flex min-h-0 w-[400px] shrink-0 flex-col overflow-hidden rounded-[2rem] border-white/60 shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
    >
      <div className="flex items-start gap-2 border-b border-white/60 px-5 pb-3 pt-5">
        {showBack ? (
          <button
            type="button"
            onClick={() => setActiveSection(null)}
            aria-label={t('Tester.settings.back', { defaultValue: 'Back' })}
            title={t('Tester.settings.back', { defaultValue: 'Back' })}
            className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-raised)] hover:text-[var(--nimi-text-primary)]"
          >
            {BACK_ICON}
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{headerTitle}</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">{headerSubtitle}</p>
        </div>
        <DesktopIconToggleAction
          icon={CLOSE_ICON}
          aria-label={t('Chat.closePanel', { defaultValue: 'Close panel' })}
          title={t('Chat.closePanel', { defaultValue: 'Close panel' })}
          onClick={onClose}
        />
      </div>

      <ScrollArea className={cn('min-h-0 flex-1')} viewportClassName="bg-transparent" contentClassName="px-5 py-5">
        {inDetail ? (
          <SectionDetail
            section={activeSection!}
            surface={surface}
            config={liveConfig}
            imageContext={imageContext}
            videoContext={videoContext}
          />
        ) : (
          <SectionList
            surface={surface}
            config={liveConfig}
            onSelect={setActiveSection}
            profile={profile}
          />
        )}
      </ScrollArea>

      {inDetail ? (
        <DetailFooter
          onReset={() => {
            const ids = selectEnabledDescriptors(surface.enabledCapabilities, CANONICAL_CAPABILITY_CATALOG_BY_ID)
              .filter((d) => d.section === activeSection)
              .map((d) => d.capabilityId);
            clearSectionParams(surface, ids);
          }}
          onDone={onClose}
          resetLabel={t('Tester.settings.reset', { defaultValue: 'Reset' })}
          doneLabel={t('Tester.settings.save', { defaultValue: 'Save Changes' })}
        />
      ) : null}
    </Surface>
  );
}

function DetailFooter(props: {
  onReset: () => void;
  onDone: () => void;
  resetLabel: string;
  doneLabel: string;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-white/60 bg-white/40 px-5 py-3">
      <button
        type="button"
        onClick={props.onReset}
        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--nimi-border-subtle,#e2e8f0)] bg-white text-[13px] font-medium text-[var(--nimi-text-secondary,#475569)] transition-colors hover:border-[var(--nimi-border-strong,#cbd5e1)] hover:text-[var(--nimi-text-primary,#0f172a)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <polyline points="3 4 3 10 9 10" />
        </svg>
        {props.resetLabel}
      </button>
      <button
        type="button"
        onClick={props.onDone}
        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-600"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
        {props.doneLabel}
      </button>
    </div>
  );
}
