import {
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  createEmptyNimiMemoryEmbeddingConfig,
  projectNimiMemoryEmbeddingRouteAvailability,
  type NimiMemoryEmbeddingConfig,
  type NimiRuntimeRouteOptionsSnapshot,
  type NimiRuntimeRouteTargetRef,
} from '@nimiplatform/sdk/runtime';
import { Surface, cn } from '@nimiplatform/kit/ui';
import { createDesktopMemoryEmbeddingScopeRef } from '@renderer/app-shell/providers/desktop-memory-embedding-scope';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
const TOKEN_PANEL_CARD = 'rounded-2xl';

type AvailabilityTone = 'success' | 'warning' | 'neutral';

const AVAILABILITY_BADGE_CLASS: Record<AvailabilityTone, { pill: string; dot: string }> = {
  success: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
    dot: 'bg-[var(--nimi-status-success)]',
  },
  warning: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
    dot: 'bg-[var(--nimi-status-warning)]',
  },
  neutral: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)] text-[var(--nimi-text-secondary)]',
    dot: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_65%,transparent)]',
  },
};

type RuntimeConfigMemoryEmbeddingSectionProps = {
  state: RuntimeConfigStateV11;
};

type MemoryEmbeddingRouteCandidate = {
  id: string;
  label: string;
  detail: string;
  tone: AvailabilityTone;
  state: string;
};

function buildCloudCandidateConfig(
  base: NimiMemoryEmbeddingConfig,
  connectorId: string,
  remoteModelCatalogId: string,
  providerModelId: string,
  provider: string,
): NimiMemoryEmbeddingConfig {
  return {
    ...base,
    sourceKind: 'cloud',
    bindingRef: {
      kind: 'cloud',
      connectorId,
      remoteModelCatalogId,
      providerModelId,
      provider,
    },
  };
}

function buildLocalCandidateConfig(base: NimiMemoryEmbeddingConfig, targetRef: NimiRuntimeRouteTargetRef): NimiMemoryEmbeddingConfig {
  if (targetRef.kind !== 'local-runtime') {
    throw new Error('memory embedding local candidate requires a local-runtime targetRef');
  }
  if (targetRef.profileBindingId) {
    return {
      ...base,
      sourceKind: 'local',
      bindingRef: {
        kind: 'local',
        profileBindingId: targetRef.profileBindingId,
      },
    };
  }
  if (!targetRef.readinessRef) {
    throw new Error('memory embedding local candidate requires a profileBindingId or readinessRef');
  }
  return {
    ...base,
    sourceKind: 'local',
    bindingRef: {
      kind: 'local',
      readinessRef: targetRef.readinessRef,
    },
  };
}

function candidateTone(state: string): AvailabilityTone {
  if (state === 'ready') {
    return 'success';
  }
  if (state === 'blocked' || state === 'unavailable') {
    return 'warning';
  }
  return 'neutral';
}

function buildCandidates(
  scopeConfig: NimiMemoryEmbeddingConfig,
  routeOptions: NimiRuntimeRouteOptionsSnapshot | null,
): MemoryEmbeddingRouteCandidate[] {
  if (!routeOptions) {
    return [];
  }
  const cloud = routeOptions.inventory.targets.flatMap((item): MemoryEmbeddingRouteCandidate[] => {
    if (item.targetRef.kind !== 'cloud-connector' || item.evidence.source !== 'cloud-connector') {
      return [];
    }
    const projection = projectNimiMemoryEmbeddingRouteAvailability({
      config: buildCloudCandidateConfig(
        scopeConfig,
        item.targetRef.connectorId,
        item.targetRef.remoteModelCatalogId,
        item.targetRef.providerModelId,
        item.targetRef.provider || item.evidence.provider || '',
      ),
      routeOptions,
    });
    return [{
        id: `cloud:${item.targetRef.connectorId}:${item.targetRef.remoteModelCatalogId}`,
        label: item.display.provider || item.targetRef.provider || item.targetRef.connectorId,
        detail: item.display.modelLabel || item.targetRef.providerModelId,
        tone: candidateTone(projection.state),
        state: String(projection.state),
      }];
    });
  const local = routeOptions.inventory.targets.flatMap((item): MemoryEmbeddingRouteCandidate[] => {
    if (item.targetRef.kind !== 'local-runtime' || item.evidence.source !== 'local-runtime') {
      return [];
    }
    const projection = projectNimiMemoryEmbeddingRouteAvailability({
      config: buildLocalCandidateConfig(scopeConfig, item.targetRef),
      routeOptions,
    });
    return [{
      id: `local:${item.evidence.localAssetId || item.targetRef.profileBindingId || item.targetRef.readinessRef}`,
      label: item.display.label || item.display.model || 'Local embedding',
      detail: item.readiness.status || 'local',
      tone: candidateTone(projection.state),
      state: String(projection.state),
    }];
  });
  return [...cloud, ...local];
}

export function RuntimeConfigMemoryEmbeddingSection(props: RuntimeConfigMemoryEmbeddingSectionProps) {
  const { t } = useTranslation();
  const scopeRef = useMemo(() => createDesktopMemoryEmbeddingScopeRef(), []);
  const scopeConfig = useMemo(() => createEmptyNimiMemoryEmbeddingConfig(scopeRef), [scopeRef]);
  const routeOptions = useMemo<NimiRuntimeRouteOptionsSnapshot>(() => {
    return {
      capability: 'text.embed',
      selectedTargetRef: null,
      inventory: {
        capability: 'text.embed',
        targets: props.state.local.models.map((model) => {
          const localAssetId = model.localModelId || model.model;
          const targetRef: NimiRuntimeRouteTargetRef = {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: `local-runtime:${localAssetId}`,
          };
          return {
            targetRef,
            display: {
              label: model.model,
              model: model.model,
              engine: model.engine,
            },
            readiness: {
              status: model.status,
            },
            compatibility: {
              capabilities: model.capabilities,
            },
            evidence: {
              source: 'local-runtime' as const,
              localAssetId,
              resolvedModelId: model.model,
              engine: model.engine,
              endpoint: model.endpoint,
            },
          };
        }),
      },
    };
  }, [props.state.local.models]);

  const candidates = useMemo(
    () => buildCandidates(scopeConfig, routeOptions),
    [routeOptions, scopeConfig],
  );
  const readyCount = candidates.filter((candidate) => candidate.tone === 'success').length;
  const badgeTone: AvailabilityTone = readyCount > 0
      ? 'success'
      : candidates.length > 0
        ? 'warning'
        : 'neutral';
  const badgeStyle = AVAILABILITY_BADGE_CLASS[badgeTone];
  const badgeLabel = readyCount > 0
      ? t('runtimeConfig.memory.ready', { defaultValue: 'Ready' })
      : t('runtimeConfig.memory.notConfigured', { defaultValue: 'Not configured' });
  const hint = t('runtimeConfig.memory.scopeHint', {
    defaultValue: 'Memory embedding binding intent is saved per agent by Runtime when you explicitly upgrade an agent memory bank.',
  });

  return (
    <section>
      <SectionTitle>
        {t('runtimeConfig.memory.sectionTitle', { defaultValue: 'Memory Embedding' })}
      </SectionTitle>
      <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'mt-3 p-5')}>
        <div className="flex items-center justify-between gap-3">
          <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
            {t('runtimeConfig.memory.sourceBindingTitle', { defaultValue: 'Embedding Source Availability' })}
          </h3>
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', badgeStyle.pill)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', badgeStyle.dot)} />
            {badgeLabel}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {candidates.length > 0 ? candidates.slice(0, 6).map((candidate) => {
            const style = AVAILABILITY_BADGE_CLASS[candidate.tone];
            return (
              <div
                key={candidate.id}
                className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={cn('truncate text-sm font-medium', TOKEN_TEXT_PRIMARY)}>{candidate.label}</p>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', style.pill)}>
                    {candidate.state}
                  </span>
                </div>
                <p className={cn('mt-1 truncate font-mono text-xs', TOKEN_TEXT_SECONDARY)}>{candidate.detail}</p>
              </div>
            );
          }) : (
            <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-4 lg:col-span-2">
              <p className={cn('text-sm font-medium', TOKEN_TEXT_PRIMARY)}>
                {t('runtimeConfig.memory.notConfigured', { defaultValue: 'Not configured' })}
              </p>
              <p className={cn('mt-1 text-xs', TOKEN_TEXT_SECONDARY)}>
                {t('runtimeConfig.memory.notConfiguredHint', {
                  defaultValue: 'No Runtime text.embed route is currently available.',
                })}
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={cn('text-[10px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
              {t('runtimeConfig.memory.currentSelection', { defaultValue: 'Runtime-owned intent' })}
            </p>
            <p className={cn('font-mono text-sm', TOKEN_TEXT_PRIMARY)}>
              {readyCount}/{candidates.length}
            </p>
          </div>
          <p className={cn('mt-2 text-xs', TOKEN_TEXT_SECONDARY)}>{hint}</p>
        </div>
      </Surface>
    </section>
  );
}
