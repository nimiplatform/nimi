// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiAIConfigCloudConnectorOption,
  NimiAIConfigCloudTargetOption,
} from '@nimiplatform/sdk/ai';
import { Button, InlineAlert, LoadingSkeleton, SearchField, StatusBadge } from '@nimiplatform/kit/ui';
import { Check, Cloud, Plus } from 'lucide-react';
import { ProviderLogoTile } from '../../components/provider-logo-tile.js';
import {
  commitRuntimeSetupCloudUse,
  type RuntimeSetupRunnerPorts,
} from './runtime-setup-task-runner.js';
import type {
  RuntimeSetupTask,
  RuntimeSetupTaskStore,
  RuntimeSetupCloudRecommendation,
} from './runtime-setup-task-store.js';
import { RuntimeConfigConnectorCreateForm } from './runtime-config-connector-create-form.js';

function canonicalCloudValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalCloudValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonicalCloudValue(entry)]));
  }
  return value;
}

function normalizedCloudTargetKey(key: string | undefined): string {
  if (!key) return '';
  try { return JSON.stringify(canonicalCloudValue(JSON.parse(key))); } catch { return ''; }
}

/**
 * Stable identity for one exact cloud target: the Driver-owned implementation
 * plus the provider-model target under one connection.
 */
export function runtimeSetupCloudTargetKey(target: NimiAIConfigCloudTargetOption): string {
  return JSON.stringify([
    target.connectorRef,
    target.implementation.implementationId,
    target.implementation.driverId,
    target.implementation.driverDialect,
    canonicalCloudValue(target.providerModelTarget),
  ]);
}

export function matchesRuntimeSetupCloudRecommendation(
  target: NimiAIConfigCloudTargetOption,
  recommendation: RuntimeSetupCloudRecommendation,
): boolean {
  return target.implementation.implementationId === recommendation.implementation.implementationId
    && target.implementation.driverId === recommendation.implementation.driverId
    && target.implementation.driverDialect === recommendation.implementation.driverDialect
    && JSON.stringify(canonicalCloudValue(target.providerModelTarget)) === JSON.stringify(canonicalCloudValue(recommendation.providerModelTarget));
}

/**
 * Cloud branch of the setup task: pick one visible connection, then one exact
 * cloud target, then save the source owner's AIConfig route. Saving performs
 * no machine write. When no connection exists, the shared creation form is
 * embedded in place; probe/test results never claim inference success.
 */
export function RuntimeSetupTaskCloudPanel(props: {
  readonly task: RuntimeSetupTask;
  readonly store: RuntimeSetupTaskStore;
  readonly ports: RuntimeSetupRunnerPorts;
  readonly onBusyChange: (busy: boolean) => void;
  readonly selectionOnly?: boolean;
  readonly ownerLabel?: string;
}) {
  const { t } = useTranslation();
  const { task } = props;
  const aiConfig = useMemo(
    () => props.ports.aiConfigForSource(task.source),
    [props.ports, task.source],
  );
  const [connectors, setConnectors] = useState<readonly NimiAIConfigCloudConnectorOption[] | null>(null);
  const [connectorsError, setConnectorsError] = useState('');
  const [targets, setTargets] = useState<readonly NimiAIConfigCloudTargetOption[] | null>(null);
  const [targetsError, setTargetsError] = useState('');
  const [selectedConnectorRef, setSelectedConnectorRef] = useState(task.draft?.cloudConnectorRef ?? '');
  const [selectedTargetKey, setSelectedTargetKey] = useState(() => normalizedCloudTargetKey(task.draft?.cloudTargetKey));
  const [targetQuery, setTargetQuery] = useState(task.draft?.cloudTargetSearch ?? '');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const recommendation = task.draft?.cloudRecommendation;

  useEffect(() => {
    if (!aiConfig) return undefined;
    let active = true;
    setConnectorsError('');
    void aiConfig.listOptions({ kind: 'cloud-connectors', capabilityContract: task.capabilityContract })
      .then((result) => {
        if (!active) return;
        setConnectors(result.kind === 'cloud-connectors' ? result.options : []);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setConnectorsError(error instanceof Error ? error.message : String(error || ''));
      });
    return () => {
      active = false;
    };
  }, [aiConfig, reloadNonce, task.capabilityContract]);

  useEffect(() => {
    if (!aiConfig || !selectedConnectorRef || connectors === null) {
      setTargets(null);
      return undefined;
    }
    if (!connectors.some(option => option.connectorRef === selectedConnectorRef)) {
      setTargets([]);
      setTargetsError(t('runtimeConfig.cloudWorkspace.connectionNotSelectable'));
      return undefined;
    }
    let active = true;
    setTargets(null);
    setTargetsError('');
    void aiConfig.listOptions({
      kind: 'cloud-targets',
      capabilityContract: task.capabilityContract,
      connectorRef: selectedConnectorRef,
    })
      .then((result) => {
        if (!active) return;
        // Some catalog projections repeat the same exact target. One target
        // must have one row/key; duplicate React keys leave stale rows behind
        // when the user filters the list.
        setTargets(result.kind === 'cloud-targets'
          ? [...new Map(result.options.map((target) => [runtimeSetupCloudTargetKey(target), target])).values()]
          : []);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setTargetsError(error instanceof Error ? error.message : String(error || ''));
      });
    return () => {
      active = false;
    };
  }, [aiConfig, connectors, reloadNonce, selectedConnectorRef, task.capabilityContract, t]);

  // Prefill only after the user chooses a connection, and never replace an
  // explicit target selection with a late recommendation response.
  useEffect(() => {
    if (!recommendation || !targets || !selectedConnectorRef || selectedTargetKey) return;
    const matches = targets.filter((target) => target.connectorRef === selectedConnectorRef
      && target.state === 'ready' && matchesRuntimeSetupCloudRecommendation(target, recommendation));
    if (matches.length !== 1) return;
    const target = matches[0]!;
    const key = runtimeSetupCloudTargetKey(target);
    setSelectedTargetKey((previous) => previous || key);
    props.store.updateTask(task.taskId, (current) => (
      current.draft?.cloudConnectorRef === selectedConnectorRef && !current.draft.cloudTargetKey
        ? { draft: { ...current.draft, cloudTargetKey: key, cloudTargetLabel: target.label } }
        : {}
    ));
  }, [recommendation, targets, selectedConnectorRef, selectedTargetKey, props.store, task.taskId]);

  const onSelectConnector = useCallback((connectorRef: string) => {
    setSelectedConnectorRef(connectorRef);
    setSelectedTargetKey('');
    setTargetQuery('');
    setBlockedMessage('');
    props.store.updateTask(props.task.taskId, (current) => ({
      draft: {
        ...(current.draft ?? {}),
        route: 'cloud',
        cloudConnectorRef: connectorRef,
        cloudTargetKey: undefined,
        cloudTargetLabel: undefined,
      },
    }));
  }, [props.store, props.task.taskId]);

  const onSelectTarget = useCallback((target: NimiAIConfigCloudTargetOption) => {
    const key = runtimeSetupCloudTargetKey(target);
    setSelectedTargetKey(key);
    setBlockedMessage('');
    props.store.updateTask(props.task.taskId, (current) => ({
      draft: {
        ...(current.draft ?? {}),
        route: 'cloud',
        cloudTargetKey: key,
        cloudTargetLabel: target.label,
      },
    }));
  }, [props.store, props.task.taskId]);

  const selectedTarget = (targets ?? []).find((target) => runtimeSetupCloudTargetKey(target) === selectedTargetKey) ?? null;
  const visibleTargets = (targets ?? []).filter((target) => target.label.toLocaleLowerCase().includes(targetQuery.trim().toLocaleLowerCase()));
  const selectedTargetReady = selectedTarget?.state === 'ready' && Boolean(connectors?.some(option => option.connectorRef === selectedConnectorRef));
  const onSave = useCallback(() => {
    if (!selectedTarget || !selectedTargetReady) return;
    setBusy(true);
    props.onBusyChange(true);
    setBlockedMessage('');
    void commitRuntimeSetupCloudUse(props.store, props.task.taskId, props.ports, {
      connectorRef: selectedTarget.connectorRef,
      implementation: selectedTarget.implementation,
      providerModelTarget: selectedTarget.providerModelTarget,
      ...(selectedTarget.label ? { targetLabel: selectedTarget.label } : {}),
    }).then((result) => {
      if (result.status === 'blocked') {
        setBlockedMessage(result.failure.message);
      }
      // ok/needs-attention/failed are projected from the task status by the
      // parent view; nothing else is written here.
    }).finally(() => {
      setBusy(false);
      props.onBusyChange(false);
    });
  }, [props, selectedTarget, selectedTargetReady]);

  if (!aiConfig) {
    return (
      <InlineAlert tone="warning" data-testid="runtime-setup-cloud-owner-required">
        {t('runtimeConfig.setupTask.cloud.ownerRequired', {
          defaultValue: 'A cloud route can only be saved for a specific app or the shared LocalAgent.',
        })}
      </InlineAlert>
    );
  }

  const readyConnectors = (connectors ?? []).filter((connector) => connector.state === 'ready');
  const blockedConnectors = (connectors ?? []).filter((connector) => connector.state !== 'ready');

  return (
    <div className="space-y-5" data-testid="runtime-setup-task-cloud">
      {recommendation ? (
        <InlineAlert tone="info" data-testid="runtime-setup-cloud-recommendation">
          <div>{t('runtimeConfig.setupTask.cloud.profileRecommendation', {
            defaultValue: "Shared setup recommendation: {{model}}. Choose your connection to check availability.",
            model: typeof recommendation.providerModelTarget.providerModelId === 'string'
              ? recommendation.providerModelTarget.providerModelId : recommendation.implementation.implementationId,
          })}</div>
          {targets && !targetsError && !targets.some((target) => target.state === 'ready' && matchesRuntimeSetupCloudRecommendation(target, recommendation)) ? (
            <p className="mt-1">{t('runtimeConfig.setupTask.cloud.recommendationUnavailable', { defaultValue: "The recommended model is not available through this connection. You can choose another model below." })}</p>
          ) : null}
          {selectedTarget && !matchesRuntimeSetupCloudRecommendation(selectedTarget, recommendation) ? (
            <p className="mt-1">{t('runtimeConfig.setupTask.cloud.recommendationReplaced', { defaultValue: "Saving will use your selected model instead of the shared recommendation." })}</p>
          ) : null}
        </InlineAlert>
      ) : null}
      <section className="space-y-4 rounded-3xl bg-[var(--nimi-surface-card)] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('runtimeConfig.setupTask.cloud.connectionLabel', { defaultValue: 'Cloud service' })}</h2>
          {!showCreateForm ? <Button tone="ghost" size="sm" disabled={busy} onClick={() => setShowCreateForm(true)} data-testid="runtime-setup-cloud-add-connector">
            <Plus size={15} aria-hidden="true" />{t('runtimeConfig.setupTask.cloud.addConnection', { defaultValue: 'Add a connection' })}
          </Button> : null}
        </div>
      {connectorsError ? (
        <InlineAlert tone="danger">
          <div>{t('runtimeConfig.setupTask.cloud.loadFailed', { defaultValue: 'Cloud options could not be loaded.' })}</div>
          <div className="mt-1 text-xs">{connectorsError}</div>
          <Button size="sm" tone="secondary" className="mt-2" onClick={() => setReloadNonce((value) => value + 1)}>
            {t('Common.retry', { defaultValue: 'Retry' })}
          </Button>
        </InlineAlert>
      ) : null}
      {connectors === null && !connectorsError ? <LoadingSkeleton className="h-20 w-full" /> : null}
      {connectors !== null ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3" data-testid="runtime-setup-cloud-connectors" role="radiogroup" aria-label={t('runtimeConfig.setupTask.cloud.connectionLabel')}>
          {readyConnectors.map((connector) => (
            <label
              key={connector.connectorRef}
              className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--nimi-focus-ring-color)] ${selectedConnectorRef === connector.connectorRef ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)]' : 'border-transparent bg-[var(--nimi-surface-panel)] hover:border-[var(--nimi-border-subtle)]'}`}
              data-testid={`runtime-setup-cloud-connector:${connector.connectorRef}`}
            >
              <input
                type="radio"
                name="runtime-setup-cloud-connector"
                className="sr-only"
                disabled={busy}
                checked={selectedConnectorRef === connector.connectorRef}
                onChange={() => onSelectConnector(connector.connectorRef)}
              />
              <ProviderLogoTile provider={connector.provider} label={connector.label} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium text-[var(--nimi-text-primary)]">{connector.label}</span>
                {connector.label.toLocaleLowerCase() !== connector.provider.toLocaleLowerCase() ? <span className="mt-0.5 block text-xs text-[var(--nimi-text-secondary)]">{connector.provider}</span> : null}
              </span>
              <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-full ${selectedConnectorRef === connector.connectorRef ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : 'border border-[var(--nimi-border-strong)]'}`}>
                {selectedConnectorRef === connector.connectorRef ? <Check size={13} /> : null}
              </span>
            </label>
          ))}
          {blockedConnectors.map((connector) => (
            <div
              key={connector.connectorRef}
              className="flex items-center justify-between gap-2 rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] px-3 py-2 opacity-75"
              data-testid={`runtime-setup-cloud-connector-blocked:${connector.connectorRef}`}
            >
              <span className="min-w-0 truncate text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
                {connector.label}
              </span>
              <StatusBadge tone="warning" shape="soft">
                {t('runtimeConfig.setupTask.cloud.connectorBlocked', { defaultValue: 'Needs attention' })}
              </StatusBadge>
            </div>
          ))}
          {readyConnectors.length === 0 && blockedConnectors.length === 0 && !showCreateForm ? (
            <p className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.setupTask.cloud.noConnectors', {
                defaultValue: "No connection is available yet. Add one to continue.",
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      {showCreateForm ? (
        <div className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-3" data-testid="runtime-setup-cloud-create">
          <RuntimeConfigConnectorCreateForm
            testIdPrefix="runtime-setup-cloud-create-form"
            onCreated={(connectorId) => {
              setShowCreateForm(false);
              onSelectConnector(connectorId);
              setReloadNonce((value) => value + 1);
            }}
            onCancel={() => setShowCreateForm(false)}
          />
          <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.setupTask.cloud.createHonestyNote', {
              defaultValue: 'Creating a connection stores its credential. It does not prove that a real model request succeeds.',
            })}
          </p>
        </div>
      ) : null}
      </section>
      {selectedConnectorRef && connectors !== null ? (
        <section className="space-y-4 rounded-3xl bg-[var(--nimi-surface-card)] p-5 sm:p-6" data-testid="runtime-setup-cloud-targets">
          <h2 className="text-sm font-semibold">{t('runtimeConfig.setupTask.cloud.targetLabel', { defaultValue: 'Choose a model' })}</h2>
          {targets === null && !targetsError ? <LoadingSkeleton className="h-16 w-full" /> : null}
          {targetsError ? (
            <InlineAlert tone="danger">
              <div>{t('runtimeConfig.setupTask.cloud.loadFailed', { defaultValue: 'Cloud options could not be loaded.' })}</div>
              <div className="mt-1 text-xs">{targetsError}</div>
              <Button tone="secondary" size="sm" className="mt-2" onClick={() => setReloadNonce((value) => value + 1)}>{t('Common.retry', { defaultValue: 'Retry' })}</Button>
            </InlineAlert>
          ) : null}
          {targets !== null && targets.length === 0 ? (
            <p className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.setupTask.cloud.noTargets', {
                defaultValue: "This connection has no available models for this capability.",
              })}
            </p>
          ) : null}
          {targets && targets.length > 0 ? (
            <SearchField
              value={targetQuery} onChange={(event) => setTargetQuery(event.currentTarget.value)}
              onClear={() => setTargetQuery('')} clearLabel={t('Common.clear')}
              disabled={busy}
              aria-label={t('runtimeConfig.setupTask.cloud.searchModels', { defaultValue: 'Search models' })}
              placeholder={t('runtimeConfig.setupTask.cloud.searchModels', { defaultValue: 'Search models' })}
              className="w-full"
              data-testid="runtime-setup-cloud-search"
            />
          ) : null}
          {targets && targets.length > 0 && visibleTargets.length === 0 ? (
            <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.setupTask.cloud.noSearchMatches', { defaultValue: 'No matching models. Try another name.' })}</p>
          ) : null}
          <div className="space-y-3" role="radiogroup" aria-label={t('runtimeConfig.setupTask.cloud.targetLabel')}>
          {visibleTargets.map((target) => {
            const key = runtimeSetupCloudTargetKey(target);
            const ready = target.state === 'ready';
            const selected = selectedTargetKey === key;
            return (
              <div
                key={key}
                className={`overflow-hidden rounded-2xl border transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--nimi-focus-ring-color)] ${selected ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)]' : 'border-transparent bg-[var(--nimi-surface-panel)]'} ${ready ? 'hover:border-[var(--nimi-action-primary-bg)]' : 'border-dashed border-[var(--nimi-border-subtle)]'}`}
                data-testid={`runtime-setup-cloud-target:${target.label}`}
              >
                <label className={`flex items-center gap-4 p-4 ${ready && !busy ? 'cursor-pointer' : 'cursor-default'}`}>
                <input
                  type="radio"
                  name="runtime-setup-cloud-target"
                  className="sr-only"
                  disabled={!ready || busy}
                  checked={selected}
                  onChange={() => onSelectTarget(target)}
                />
                <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-surface-card)] text-[var(--nimi-action-primary-bg)]"><Cloud size={23} strokeWidth={1.6} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-base font-semibold text-[var(--nimi-text-primary)]">{target.label}</span>
                  {target.reasons.length > 0 ? <span className="mt-1 block text-xs text-[var(--nimi-text-secondary)]">{target.reasons.join(', ')}</span> : null}
                  {recommendation && matchesRuntimeSetupCloudRecommendation(target, recommendation) ? <span className="mt-1 block text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.setupTask.cloud.recommendedTarget', { defaultValue: 'From shared setup' })}</span> : null}
                </span>
                {!ready ? (
                  <StatusBadge tone="warning" shape="soft">
                    {t('runtimeConfig.setupTask.cloud.targetBlocked', { defaultValue: 'Not ready' })}
                  </StatusBadge>
                ) : null}
                <span aria-hidden="true" className={`flex size-6 shrink-0 items-center justify-center rounded-full ${selected ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : 'border border-[var(--nimi-border-strong)]'}`}>
                  {selected ? <Check size={15} /> : null}
                </span>
                </label>
                <details className="px-4 pb-3 text-xs text-[var(--nimi-text-secondary)]">
                  <summary className="w-fit cursor-pointer">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
                  <p className="mt-2 break-all">{target.implementation.implementationId} · {target.implementation.driverId} · {target.implementation.driverDialect}</p>
                </details>
              </div>
            );
          })}
          </div>
        </section>
      ) : null}
      {blockedMessage ? <InlineAlert tone="warning">{blockedMessage}</InlineAlert> : null}
      <div className="space-y-4 px-1 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-4">
      {selectedTarget ? (
        <p className="min-w-0 break-words text-sm font-medium text-[var(--nimi-text-primary)]" data-testid="runtime-setup-cloud-selected" aria-live="polite">
          {t('runtimeConfig.setupTask.cloud.selectedModel', { defaultValue: 'Selected model: {{model}}', model: selectedTarget.label })}
        </p>
      ) : <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.setupTask.cloud.chooseBeforeSave', { defaultValue: 'Select a model to continue.' })}</p>}
      {!props.selectionOnly ? (
        <Button
          tone="primary"
          className="max-w-full whitespace-normal text-center"
          disabled={!selectedTargetReady || busy}
          onClick={onSave}
          data-testid="runtime-setup-cloud-save"
        >
          {busy
            ? t('runtimeConfig.setupTask.cloud.saving', { defaultValue: 'Saving…' })
            : props.ownerLabel ? t('runtimeConfig.setupTask.cloud.saveForOwner', { defaultValue: 'Save for {{owner}}', owner: props.ownerLabel })
              : t('runtimeConfig.setupTask.cloud.saveRoute', { defaultValue: 'Save and use this model' })}
        </Button>
      ) : null}
      </div>
      <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('runtimeConfig.setupTask.cloud.executionNote', { defaultValue: 'Saving makes no AI request. When used, requests go to this cloud service and may incur provider charges.' })}</p>
      </div>
    </div>
  );
}
