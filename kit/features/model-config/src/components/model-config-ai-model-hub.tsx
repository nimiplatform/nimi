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

export type ModelConfigAiModelHubProps = {
  surface: AppModelConfigSurface;
  profile: ModelConfigProfileController;
  footer?: ReactNode;
  className?: string;
};

function statusToneDotClass(tone: ModelConfigStatusTone): string {
  if (tone === 'attention') return 'bg-amber-400';
  if (tone === 'ready') return 'bg-emerald-400';
  return 'bg-slate-300';
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
  const { surface, profile, footer, className } = props;
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

      {activeSection === null ? (
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
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            className="flex items-center gap-2 text-xs font-medium text-[var(--nimi-text-secondary,#475569)] hover:text-[var(--nimi-text-primary,#0f172a)]"
            onClick={() => setActiveSection(null)}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
            </svg>
            <span>{t('ModelConfig.hub.backLabel')}</span>
          </button>
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            {t(`ModelConfig.section.${activeSection}.title`)}
          </h3>
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
        </div>
      )}

      {footer}
    </div>
  );
}
