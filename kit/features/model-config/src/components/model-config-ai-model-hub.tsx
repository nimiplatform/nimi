import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AIConfig } from '@nimiplatform/sdk/mod';
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
import type { ModelConfigProfileController } from '../types.js';
import { ProfileConfigSection } from './profile-config-section.js';
import { ModelConfigCapabilityDetail } from './model-config-capability-detail.js';

// Canonical section ordering — mirrors P-CAPCAT-001 enum.
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

/**
 * Optional super-section grouping that re-arranges the hub into a 2-column
 * grid with section dividers. Each super-section maps one or more granular
 * canonical sections (e.g. 'chat'+'embed' → "Conversation"). When provided,
 * the hub also renders the Profile Import button as a full-width row above
 * the grid instead of right-aligned in the header.
 */
export type ModelConfigSuperSection = {
  id: string;
  /** Display label (already-translated string). */
  label: string;
  /** Granular canonical sections that belong to this super-section. */
  sections: ReadonlyArray<CanonicalCapabilitySectionId>;
};

export type ModelConfigAiModelHubProps = {
  surface: AppModelConfigSurface;
  profile: ModelConfigProfileController;
  footer?: ReactNode;
  className?: string;
  superSections?: ReadonlyArray<ModelConfigSuperSection>;
};

function statusToneDotClass(tone: ModelConfigStatusTone): string {
  if (tone === 'attention') return 'bg-amber-400';
  if (tone === 'ready') return 'bg-emerald-400';
  return 'bg-slate-300';
}

function statusToneDotMicroClass(tone: ModelConfigStatusTone): string {
  if (tone === 'attention') return 'bg-amber-500';
  if (tone === 'ready') return 'bg-emerald-500';
  return 'bg-slate-400';
}

function sectionIconPath(section: CanonicalCapabilitySectionId): string {
  switch (section) {
    case 'chat':
      // Chat bubble
      return 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z';
    case 'tts':
      // Volume / speaker
      return 'M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07';
    case 'stt':
      // Microphone
      return 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8';
    case 'voice':
      // Headphones / voice workflow
      return 'M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z';
    case 'image':
      // Image / picture
      return 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM21 15l-5-5L5 21';
    case 'video':
      // Video / play frame
      return 'M23 7l-7 5 7 5V7zM3 7a2 2 0 0 1 2-2h11v14H5a2 2 0 0 1-2-2V7z';
    case 'embed':
      // Cube / box (embeddings vector)
      return 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01 20.73 6.96M12 22.08V12';
    case 'world':
      // Globe
      return 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z';
    default:
      return 'M12 2v20';
  }
}

function CapIcon(props: { section: CanonicalCapabilitySectionId; tone: ModelConfigStatusTone }) {
  const bgClass = props.tone === 'ready'
    ? 'bg-emerald-500/10 text-emerald-700'
    : props.tone === 'attention'
      ? 'bg-amber-500/15 text-amber-700'
      : 'bg-slate-500/10 text-slate-500';
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${bgClass}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d={sectionIconPath(props.section)} />
      </svg>
    </span>
  );
}

function groupDescriptorsBySection(
  descriptors: ReadonlyArray<CanonicalCapabilityDescriptor>,
): Map<CanonicalCapabilitySectionId, CanonicalCapabilityDescriptor[]> {
  const map = new Map<CanonicalCapabilitySectionId, CanonicalCapabilityDescriptor[]>();
  for (const descriptor of descriptors) {
    const list = map.get(descriptor.section) ?? [];
    list.push(descriptor);
    map.set(descriptor.section, list);
  }
  return map;
}

function useLiveConfig(surface: AppModelConfigSurface): AIConfig {
  const [config, setConfig] = useState<AIConfig>(() => surface.aiConfigService.aiConfig.get(surface.scopeRef));
  useEffect(() => {
    setConfig(surface.aiConfigService.aiConfig.get(surface.scopeRef));
    return surface.aiConfigService.aiConfig.subscribe(surface.scopeRef, (next) => {
      setConfig(next);
    });
  }, [surface.aiConfigService, surface.scopeRef]);
  return config;
}

export function ModelConfigAiModelHub(props: ModelConfigAiModelHubProps) {
  const { surface, profile, footer, className, superSections } = props;
  const config = useLiveConfig(surface);
  const t = surface.i18n.t;
  const [activeSection, setActiveSection] = useState<CanonicalCapabilitySectionId | null>(null);

  const descriptors = useMemo(
    () => selectEnabledDescriptors(surface.enabledCapabilities, CANONICAL_CAPABILITY_CATALOG_BY_ID),
    [surface.enabledCapabilities],
  );

  const sectionMap = useMemo(() => groupDescriptorsBySection(descriptors), [descriptors]);

  const orderedSections = useMemo(
    () => SECTION_ORDER.filter((section) => sectionMap.has(section)),
    [sectionMap],
  );

  const evaluations: ReadonlyArray<CapabilityEvaluation> = useMemo(() => {
    const out: CapabilityEvaluation[] = [];
    for (const descriptor of descriptors) {
      const projection = surface.projectionResolver(descriptor.capabilityId);
      const bindingPresent = Boolean(config.capabilities.selectedBindings?.[descriptor.capabilityId]);
      out.push({
        capabilityId: descriptor.capabilityId,
        descriptor,
        status: projection,
        bindingPresent,
      });
    }
    return out;
  }, [config, descriptors, surface]);

  const aggregate = useMemo(
    () => summarizeAiModelAggregate(evaluations, {
      ready: t('ModelConfig.hub.aggregateReady'),
      attention: t('ModelConfig.hub.aggregateAttention'),
      neutral: t('ModelConfig.hub.aggregateNeutral'),
    }),
    [evaluations, t],
  );

  const detailDescriptors = activeSection ? sectionMap.get(activeSection) ?? [] : [];

  // Renders a single capability section card in the grouped 2-column grid.
  function renderSectionCard(section: CanonicalCapabilitySectionId) {
    const items = sectionMap.get(section) ?? [];
    if (items.length === 0) return null;
    const sectionEvaluations = evaluations.filter((entry) => entry.descriptor.section === section);
    const sectionAggregate = summarizeAiModelAggregate(sectionEvaluations, {
      ready: t('ModelConfig.hub.aggregateReady'),
      attention: t('ModelConfig.hub.aggregateAttention'),
      neutral: t('ModelConfig.hub.aggregateNeutral'),
    });
    const sectionTitleKey = `ModelConfig.section.${section}.title`;
    const firstDescriptor = items[0];
    const tone = sectionAggregate.statusDot;
    const cardToneClass = tone === 'attention'
      ? 'border-amber-300/50 bg-amber-50/50 hover:border-amber-400'
      : tone === 'ready'
        ? 'border-slate-200/90 bg-white hover:border-slate-300'
        : 'border-slate-200/90 bg-white hover:border-slate-300';
    const statusTextClass = tone === 'attention' ? 'text-amber-700' : tone === 'ready' ? 'text-emerald-700' : 'text-slate-500';
    return (
      <button
        key={section}
        type="button"
        onClick={() => setActiveSection(section)}
        className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${cardToneClass}`}
      >
        <CapIcon section={section} tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight tracking-tight text-slate-900">
            {t(sectionTitleKey)}
          </div>
          <div className={`mt-1.5 flex items-center gap-1.5 text-[11.5px] leading-[1.4] ${statusTextClass}`}>
            <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${statusToneDotMicroClass(tone)}`} />
            <span className="truncate">
              {sectionAggregate.subtitle || (firstDescriptor ? t(firstDescriptor.i18nKeys.subtitle) : '')}
            </span>
          </div>
        </div>
      </button>
    );
  }

  // Grouped 2-column grid layout (driven by props.superSections). Header is full-width,
  // capability cards are split into super-sections with horizontal-line dividers.
  if (superSections && activeSection === null) {
    return (
      <div className={className || 'space-y-5'}>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[14px] font-semibold tracking-tight text-slate-900">
            {t('ModelConfig.hub.title')}
          </h2>
          <div className="flex shrink-0 items-center gap-1.5 text-[12px] text-slate-600">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusToneDotClass(aggregate.statusDot)}`} />
            <span>{aggregate.subtitle || t('ModelConfig.hub.aggregateEmpty')}</span>
          </div>
        </div>

        <div>
          <ProfileConfigSection controller={profile} variant="import-button" />
        </div>

        {superSections.map((group) => {
          const visibleSections = group.sections.filter((s) => sectionMap.has(s));
          if (visibleSections.length === 0) return null;
          return (
            <div key={group.id}>
              <div className="mb-2.5 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{group.label}</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {visibleSections.map((s) => renderSectionCard(s))}
              </div>
            </div>
          );
        })}

        {footer}
      </div>
    );
  }

  if (activeSection !== null) {
    const sectionEvaluations = evaluations.filter((entry) => entry.descriptor.section === activeSection);
    const sectionAggregate = summarizeAiModelAggregate(sectionEvaluations, {
      ready: t('ModelConfig.hub.aggregateReady'),
      attention: t('ModelConfig.hub.aggregateAttention'),
      neutral: t('ModelConfig.hub.aggregateNeutral'),
    });
    const detailTone = sectionAggregate.statusDot;
    const detailStatusLabel = detailTone === 'ready'
      ? t('ModelConfig.hub.detailStatusReady', { defaultValue: 'Runtime Ready' })
      : detailTone === 'attention'
        ? t('ModelConfig.hub.detailStatusAttention', { defaultValue: 'Needs Setup' })
        : t('ModelConfig.hub.detailStatusNeutral', { defaultValue: 'Not Configured' });
    const detailPillClass = detailTone === 'ready'
      ? 'bg-emerald-500/10 text-emerald-700'
      : detailTone === 'attention'
        ? 'bg-amber-500/15 text-amber-700'
        : 'bg-slate-400/15 text-slate-600';
    const detailPillDotClass = detailTone === 'ready'
      ? 'bg-emerald-500'
      : detailTone === 'attention'
        ? 'bg-amber-500'
        : 'bg-slate-400';
    const sectionTitle = t(`ModelConfig.section.${activeSection}.title`);
    const detailTitle = t('ModelConfig.hub.detailTitleFormat', {
      section: sectionTitle,
      defaultValue: `${sectionTitle} Configuration`,
    });
    return (
      <div className={className || 'space-y-5'}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveSection(null)}
            aria-label={t('ModelConfig.hub.backLabel')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--nimi-text-secondary,#475569)] transition-colors hover:bg-slate-100 hover:text-[var(--nimi-text-primary,#0f172a)]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary,#0f172a)]">
            {detailTitle}
          </h2>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] ${detailPillClass}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${detailPillDotClass}`} />
            {detailStatusLabel}
          </span>
        </div>

        <div className="space-y-4">
          {detailDescriptors.map((descriptor) => (
            <ModelConfigCapabilityDetail
              key={descriptor.capabilityId}
              capabilityId={descriptor.capabilityId}
              surface={surface}
              config={config}
            />
          ))}
        </div>

        {footer}
      </div>
    );
  }

  return (
    <div className={className || 'space-y-4'}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--nimi-text-primary,#0f172a)]">
            {t('ModelConfig.hub.title')}
          </h2>
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--nimi-text-muted,#64748b)]">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusToneDotClass(aggregate.statusDot)}`} />
            <span className="truncate">
              {aggregate.subtitle || t('ModelConfig.hub.aggregateEmpty')}
            </span>
          </div>
        </div>
        <div className="w-56 shrink-0">
          <ProfileConfigSection controller={profile} variant="import-button" />
        </div>
      </div>

      <div className="space-y-2">
        {orderedSections.map((section) => {
          const items = sectionMap.get(section) ?? [];
          const sectionEvaluations = evaluations.filter((entry) => entry.descriptor.section === section);
          const sectionAggregate = summarizeAiModelAggregate(sectionEvaluations, {
            ready: t('ModelConfig.hub.aggregateReady'),
            attention: t('ModelConfig.hub.aggregateAttention'),
            neutral: t('ModelConfig.hub.aggregateNeutral'),
          });
          const sectionTitleKey = `ModelConfig.section.${section}.title`;
          const firstDescriptor = items[0];
          return (
            <button
              key={section}
              type="button"
              onClick={() => setActiveSection(section)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--nimi-border-subtle,#e2e8f0)] bg-white px-4 py-3 text-left transition-colors hover:border-[var(--nimi-border-strong,#cbd5e1)]"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--nimi-text-primary,#0f172a)]">
                  {t(sectionTitleKey)}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--nimi-text-muted,#64748b)]">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusToneDotClass(sectionAggregate.statusDot)}`} />
                  <span className="truncate">
                    {sectionAggregate.subtitle || (firstDescriptor ? t(firstDescriptor.i18nKeys.subtitle) : '')}
                  </span>
                </div>
              </div>
              <svg className="h-4 w-4 shrink-0 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          );
        })}
      </div>

      {footer}
    </div>
  );
}
