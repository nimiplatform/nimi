import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createDefaultAIScopeRef,
  type MemoryEmbeddingConfig,
} from '@nimiplatform/sdk/mod';
import { getDesktopMemoryEmbeddingConfigService } from '@renderer/app-shell/providers/desktop-memory-embedding-config-service';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { Card, RuntimeSelect } from './runtime-config-primitives';

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

  const availability = useMemo(() => {
    if (!config.sourceKind || !config.bindingRef) {
      return {
        tone: 'text-[var(--nimi-text-muted)]',
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
          tone: 'text-[var(--nimi-status-success)]',
          label: t('runtimeConfig.memory.ready', { defaultValue: 'Ready' }),
          hint: t('runtimeConfig.memory.cloudReadyHint', {
            defaultValue: 'Cloud memory embedding is configured and the selected connector advertises text.embed support.',
          }),
        };
      }
      return {
        tone: 'text-[var(--nimi-status-warning)]',
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
            tone: 'text-[var(--nimi-status-success)]',
            label: t('runtimeConfig.memory.ready', { defaultValue: 'Ready' }),
            hint: t('runtimeConfig.memory.localReadyHint', {
              defaultValue: 'A local embedding model is active and ready for future chat memory upgrades.',
            }),
          }
        : {
            tone: 'text-[var(--nimi-status-warning)]',
            label: t('runtimeConfig.memory.unavailable', { defaultValue: 'Unavailable' }),
            hint: t('runtimeConfig.memory.localUnavailableHint', {
              defaultValue: 'The saved local embedding target is no longer active. Start or install an embedding model first.',
            }),
          };
    }
    return {
      tone: 'text-[var(--nimi-text-muted)]',
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

  return (
    <section>
      <SectionTitle
        description={t('runtimeConfig.memory.sectionDescription', {
          defaultValue: 'Configure the embedding source used when chat upgrades an agent from Baseline to Standard memory.',
        })}
      >
        {t('runtimeConfig.memory.sectionTitle', { defaultValue: 'Memory Embedding' })}
      </SectionTitle>
      <Card className="mt-3 p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,200px)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
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
                <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
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
                <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
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
              <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.memory.localTarget', { defaultValue: 'Local embedding model' })}
              </label>
              <RuntimeSelect
                value={config.bindingRef?.kind === 'local' ? config.bindingRef.targetId : ''}
                onChange={handleLocalTargetChange}
                options={localEmbeddingOptions}
                placeholder={t('runtimeConfig.memory.noLocalModel', { defaultValue: 'No active local embedding model' })}
              />
            </div>
          ) : (
            <div className="lg:col-span-2 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-3 text-sm text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.memory.sourceUnsetHint', {
                defaultValue: 'Select a source to make chat memory upgrades explicit and predictable.',
              })}
            </div>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.memory.currentSelection', { defaultValue: 'Current selection' })}
            </p>
            <span className={`text-sm font-semibold ${availability.tone}`}>{availability.label}</span>
          </div>
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{savedConfigLabel(config)}</p>
          <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">{availability.hint}</p>
          <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.memory.scopeHint', {
              defaultValue: 'This is scope-level config for chat. Existing agents still move to Standard memory only when you explicitly trigger upgrade in chat.',
            })}
          </p>
        </div>
      </Card>
    </section>
  );
}
