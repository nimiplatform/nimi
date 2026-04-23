import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createDefaultAIScopeRef,
  type MemoryEmbeddingConfig,
} from '@nimiplatform/sdk/mod';
import { Surface, cn } from '@nimiplatform/nimi-kit/ui';
import { getDesktopMemoryEmbeddingConfigService } from '@renderer/app-shell/providers/desktop-memory-embedding-config-service';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { RuntimeSelect } from './runtime-config-primitives';

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

type CloudConnectorOption = {
  connectorId: string;
  label: string;
  models: string[];
};

function hasEmbeddingCapability(capabilities: string[] | undefined): boolean {
  return Array.isArray(capabilities) && capabilities.some((capability) => capability === 'embedding' || capability === 'text.embed');
}

function savedConfigLabel(config: MemoryEmbeddingConfig): string {
  if (!config.sourceKind || !config.bindingRef) {
    return 'Not configured';
  }
  if (config.sourceKind === 'cloud' && config.bindingRef.kind === 'cloud') {
    return `${config.bindingRef.connectorId} / ${config.bindingRef.modelId}`;
  }
  if (config.sourceKind === 'local' && config.bindingRef.kind === 'local') {
    return config.bindingRef.targetId;
  }
  return 'Not configured';
}

export function RuntimeConfigMemoryEmbeddingSection(props: RuntimeConfigMemoryEmbeddingSectionProps) {
  const { t } = useTranslation();
  const scopeRef = useMemo(() => createDefaultAIScopeRef(), []);
  const memoryEmbeddingService = useMemo(() => getDesktopMemoryEmbeddingConfigService(), []);
  const [config, setConfig] = useState(() => memoryEmbeddingService.memoryEmbeddingConfig.get(scopeRef));

  useEffect(() => {
    setConfig(memoryEmbeddingService.memoryEmbeddingConfig.get(scopeRef));
    return memoryEmbeddingService.memoryEmbeddingConfig.subscribe(scopeRef, (next) => {
      setConfig(next);
    });
  }, [memoryEmbeddingService, scopeRef]);

  const localEmbeddingOptions = useMemo(() => {
    const options = props.state.local.models
      .filter((model) => model.status === 'active' && model.capabilities.includes('embedding'))
      .map((model) => ({
        value: model.model,
        label: model.model,
      }));
    if (config.sourceKind === 'local' && config.bindingRef?.kind === 'local') {
      const saved = config.bindingRef.targetId;
      if (saved && !options.some((option) => option.value === saved)) {
        options.unshift({
          value: saved,
          label: `${saved} (${t('runtimeConfig.memory.savedButUnavailable', { defaultValue: 'saved, unavailable' })})`,
        });
      }
    }
    return options;
  }, [config.bindingRef, config.sourceKind, props.state.local.models, t]);

  const cloudConnectorOptions = useMemo<CloudConnectorOption[]>(() => {
    const options = props.state.connectors
      .filter((connector) => connector.status === 'healthy')
      .map((connector) => ({
        connectorId: connector.id,
        label: connector.label,
        models: Object.entries(connector.modelCapabilities || {})
          .filter(([, capabilities]) => hasEmbeddingCapability(capabilities))
          .map(([modelId]) => modelId),
      }))
      .filter((connector) => connector.models.length > 0);
    if (config.sourceKind === 'cloud' && config.bindingRef?.kind === 'cloud') {
      const savedConnectorId = config.bindingRef.connectorId;
      const savedModelId = config.bindingRef.modelId;
      const existing = options.find((option) => option.connectorId === savedConnectorId);
      if (existing && !existing.models.includes(savedModelId)) {
        existing.models.unshift(savedModelId);
      } else if (!existing && savedConnectorId && savedModelId) {
        options.unshift({
          connectorId: savedConnectorId,
          label: `${savedConnectorId} (${t('runtimeConfig.memory.savedButUnavailable', { defaultValue: 'saved, unavailable' })})`,
          models: [savedModelId],
        });
      }
    }
    return options;
  }, [config.bindingRef, config.sourceKind, props.state.connectors, t]);

  const selectedCloudConnectorId = config.sourceKind === 'cloud' && config.bindingRef?.kind === 'cloud'
    ? config.bindingRef.connectorId
    : '';
  const selectedCloudConnector = cloudConnectorOptions.find((option) => option.connectorId === selectedCloudConnectorId) || null;
  const cloudModelOptions = useMemo(() => {
    return (selectedCloudConnector?.models || []).map((modelId) => ({
      value: modelId,
      label: modelId,
    }));
  }, [selectedCloudConnector]);

  const availability = useMemo<{
    tone: AvailabilityTone;
    label: string;
    hint: string;
  }>(() => {
    if (!config.sourceKind || !config.bindingRef) {
      return {
        tone: 'neutral',
        label: t('runtimeConfig.memory.notConfigured', { defaultValue: 'Not configured' }),
        hint: t('runtimeConfig.memory.notConfiguredHint', {
          defaultValue: 'Choose a cloud connector or an active local embedding model. Chat memory upgrades will use this source.',
        }),
      };
    }
    if (config.sourceKind === 'cloud' && config.bindingRef.kind === 'cloud') {
      const cloudBinding = config.bindingRef;
      const connector = props.state.connectors.find((item) => item.id === cloudBinding.connectorId) || null;
      const healthy = connector?.status === 'healthy';
      const supportsEmbedding = hasEmbeddingCapability(connector?.modelCapabilities?.[cloudBinding.modelId]);
      if (healthy && supportsEmbedding) {
        return {
          tone: 'success',
          label: t('runtimeConfig.memory.ready', { defaultValue: 'Ready' }),
          hint: t('runtimeConfig.memory.cloudReadyHint', {
            defaultValue: 'Cloud memory embedding is configured and the selected connector advertises text.embed support.',
          }),
        };
      }
      return {
        tone: 'warning',
        label: t('runtimeConfig.memory.unavailable', { defaultValue: 'Unavailable' }),
        hint: t('runtimeConfig.memory.cloudUnavailableHint', {
          defaultValue: 'The saved cloud connector or model is no longer healthy, or it no longer exposes text.embed.',
        }),
      };
    }
    if (config.sourceKind === 'local' && config.bindingRef.kind === 'local') {
      const localBinding = config.bindingRef;
      const activeLocal = props.state.local.models.some((model) => (
        model.status === 'active'
        && model.capabilities.includes('embedding')
        && model.model === localBinding.targetId
      ));
      return activeLocal
        ? {
            tone: 'success',
            label: t('runtimeConfig.memory.ready', { defaultValue: 'Ready' }),
            hint: t('runtimeConfig.memory.localReadyHint', {
              defaultValue: 'A local embedding model is active and ready for future chat memory upgrades.',
            }),
          }
        : {
            tone: 'warning',
            label: t('runtimeConfig.memory.unavailable', { defaultValue: 'Unavailable' }),
            hint: t('runtimeConfig.memory.localUnavailableHint', {
              defaultValue: 'The saved local embedding target is no longer active. Start or install an embedding model first.',
            }),
          };
    }
    return {
      tone: 'neutral',
      label: t('runtimeConfig.memory.notConfigured', { defaultValue: 'Not configured' }),
      hint: t('runtimeConfig.memory.notConfiguredHint', {
        defaultValue: 'Choose a cloud connector or an active local embedding model. Chat memory upgrades will use this source.',
      }),
    };
  }, [config, props.state.connectors, props.state.local.models, t]);

  const commitConfig = (next: MemoryEmbeddingConfig) => {
    memoryEmbeddingService.memoryEmbeddingConfig.update(scopeRef, next);
  };

  const handleSourceKindChange = (value: string) => {
    if (value === 'cloud') {
      const firstConnector = cloudConnectorOptions[0] || null;
      const firstModel = firstConnector?.models[0] || '';
      commitConfig({
        ...config,
        scopeRef,
        sourceKind: 'cloud',
        bindingRef: firstConnector && firstModel
          ? {
              kind: 'cloud',
              connectorId: firstConnector.connectorId,
              modelId: firstModel,
            }
          : null,
      });
      return;
    }
    if (value === 'local') {
      const firstLocal = localEmbeddingOptions[0]?.value || '';
      commitConfig({
        ...config,
        scopeRef,
        sourceKind: 'local',
        bindingRef: firstLocal
          ? {
              kind: 'local',
              targetId: firstLocal,
            }
          : null,
      });
      return;
    }
    commitConfig({
      ...config,
      scopeRef,
      sourceKind: null,
      bindingRef: null,
    });
  };

  const handleCloudConnectorChange = (connectorId: string) => {
    const connector = cloudConnectorOptions.find((option) => option.connectorId === connectorId) || null;
    const modelId = connector?.models[0] || '';
    commitConfig({
      ...config,
      scopeRef,
      sourceKind: 'cloud',
      bindingRef: connector && modelId
        ? {
            kind: 'cloud',
            connectorId,
            modelId,
          }
        : null,
    });
  };

  const handleCloudModelChange = (modelId: string) => {
    if (!selectedCloudConnector) {
      return;
    }
    commitConfig({
      ...config,
      scopeRef,
      sourceKind: 'cloud',
      bindingRef: {
        kind: 'cloud',
        connectorId: selectedCloudConnector.connectorId,
        modelId,
      },
    });
  };

  const handleLocalTargetChange = (targetId: string) => {
    commitConfig({
      ...config,
      scopeRef,
      sourceKind: 'local',
      bindingRef: targetId
        ? {
            kind: 'local',
            targetId,
          }
        : null,
    });
  };

  const badgeStyle = AVAILABILITY_BADGE_CLASS[availability.tone];

  return (
    <section>
      <SectionTitle>
        {t('runtimeConfig.memory.sectionTitle', { defaultValue: 'Memory Embedding' })}
      </SectionTitle>
      <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'mt-3 p-5')}>
        {/* Header: title + availability badge */}
        <div className="flex items-center justify-between gap-3">
          <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
            {t('runtimeConfig.memory.sourceBindingTitle', { defaultValue: 'Embedding Source' })}
          </h3>
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', badgeStyle.pill)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', badgeStyle.dot)} />
            {availability.label}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,200px)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label className={cn('mb-1.5 block text-sm font-medium', TOKEN_TEXT_SECONDARY)}>
              {t('runtimeConfig.memory.sourceKind', { defaultValue: 'Source' })}
            </label>
            <RuntimeSelect
              value={config.sourceKind || ''}
              onChange={handleSourceKindChange}
              options={[
                { value: '', label: t('runtimeConfig.memory.sourceUnset', { defaultValue: 'Not configured' }) },
                { value: 'cloud', label: t('runtimeConfig.memory.sourceCloud', { defaultValue: 'Cloud connector' }) },
                { value: 'local', label: t('runtimeConfig.memory.sourceLocal', { defaultValue: 'Local model' }) },
              ]}
            />
          </div>

          {config.sourceKind === 'cloud' ? (
            <>
              <div>
                <label className={cn('mb-1.5 block text-sm font-medium', TOKEN_TEXT_SECONDARY)}>
                  {t('runtimeConfig.memory.connector', { defaultValue: 'Connector' })}
                </label>
                <RuntimeSelect
                  value={selectedCloudConnectorId}
                  onChange={handleCloudConnectorChange}
                  options={cloudConnectorOptions.map((option) => ({
                    value: option.connectorId,
                    label: option.label,
                  }))}
                  placeholder={t('runtimeConfig.memory.noCloudConnector', { defaultValue: 'No healthy embedding connector' })}
                />
              </div>
              <div>
                <label className={cn('mb-1.5 block text-sm font-medium', TOKEN_TEXT_SECONDARY)}>
                  {t('runtimeConfig.memory.model', { defaultValue: 'Embedding model' })}
                </label>
                <RuntimeSelect
                  value={config.bindingRef?.kind === 'cloud' ? config.bindingRef.modelId : ''}
                  onChange={handleCloudModelChange}
                  options={cloudModelOptions}
                  placeholder={t('runtimeConfig.memory.noCloudModel', { defaultValue: 'No embedding model discovered' })}
                />
              </div>
            </>
          ) : config.sourceKind === 'local' ? (
            <div className="lg:col-span-2">
              <label className={cn('mb-1.5 block text-sm font-medium', TOKEN_TEXT_SECONDARY)}>
                {t('runtimeConfig.memory.localTarget', { defaultValue: 'Local embedding model' })}
              </label>
              <RuntimeSelect
                value={config.bindingRef?.kind === 'local' ? config.bindingRef.targetId : ''}
                onChange={handleLocalTargetChange}
                options={localEmbeddingOptions}
                placeholder={t('runtimeConfig.memory.noLocalModel', { defaultValue: 'No active local embedding model' })}
              />
            </div>
          ) : null}
        </div>

        {/* Current selection — inset panel matching Overview meta pattern */}
        <div className="mt-5 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={cn('text-[10px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
              {t('runtimeConfig.memory.currentSelection', { defaultValue: 'Current selection' })}
            </p>
            <p className={cn('font-mono text-sm', TOKEN_TEXT_PRIMARY)}>{savedConfigLabel(config)}</p>
          </div>
          <p className={cn('mt-2 text-xs', TOKEN_TEXT_SECONDARY)}>{availability.hint}</p>
          <p className={cn('mt-2 text-[11px]', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.memory.scopeHint', {
              defaultValue: 'This is scope-level config for chat. Existing agents still move to Standard memory only when you explicitly trigger upgrade in chat.',
            })}
          </p>
        </div>
      </Surface>
    </section>
  );
}
