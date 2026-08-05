import { useEffect, useMemo, useState } from 'react';
import {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
  type NimiCapabilityAIConfigIntent,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  AgentCenterCloudAuthorizationOptions,
  AgentCenterCloudImplementationOption,
  AgentCenterCloudTargetOption,
  AgentCenterI18n,
  AgentCenterSession,
  AgentCenterSnapshot,
} from '../types.js';
import { translateAgentCenter } from '../i18n.js';
import {
  AgentButton,
  Card,
  Notice,
  SectionHeader,
  SectionShell,
  StatusPill,
  agentCenterInputClassName,
} from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

const TEXT_GENERATE_CAPABILITY = 'text.generate';
const EMPTY_AUTHORIZATION: AgentCenterCloudAuthorizationOptions = Object.freeze({
  connectors: Object.freeze([]),
  grants: Object.freeze([]),
});

export interface AgentCenterAIConfigSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
}

export function AgentCenterAIConfigSection({ session, snapshot, i18n }: AgentCenterAIConfigSectionProps) {
  const projection = snapshot.state.sharedAIConfig;
  const availability = snapshot.availability.overwriteSharedAIConfig;
  const currentTextIntent = projection?.aiConfig.capabilities.find(
    (intent) => intent.capabilityContract === TEXT_GENERATE_CAPABILITY,
  ) ?? null;
  const currentCloud = currentTextIntent?.route.oneofKind === 'cloud'
    ? currentTextIntent.route.cloud
    : null;
  const currentTarget = useMemo(
    () => runtimeAIConfigStructToJson(currentCloud?.providerModelTarget),
    [currentCloud?.providerModelTarget],
  );
  const currentProvider = jsonText(currentTarget.provider);
  const currentModelId = jsonText(currentTarget.providerModelId) || jsonText(currentTarget.model);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [cloudEditing, setCloudEditing] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [authorizationError, setAuthorizationError] = useState('');
  const [implementations, setImplementations] = useState<readonly AgentCenterCloudImplementationOption[]>([]);
  const [targets, setTargets] = useState<readonly AgentCenterCloudTargetOption[]>([]);
  const [authorization, setAuthorization] = useState<AgentCenterCloudAuthorizationOptions>(EMPTY_AUTHORIZATION);
  const [implementationId, setImplementationId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [grantId, setGrantId] = useState('');
  const [connectorId, setConnectorId] = useState('');
  const [targetConfirmed, setTargetConfirmed] = useState(false);
  const [sharedScopeConfirmed, setSharedScopeConfirmed] = useState(false);
  const labels = useMemo(() => ({
    title: translateAgentCenter(i18n, 'AgentCenter.aiConfig.sectionTitle', 'AI configuration'),
    description: translateAgentCenter(
      i18n,
      'AgentCenter.aiConfig.capabilityConfigurationDescription',
      'Choose Local or Cloud capability intent. Runtime validates the committed implementation when execution starts.',
    ),
    local: translateAgentCenter(i18n, 'AgentCenter.aiConfig.localIntentLabel', 'Local'),
    cloud: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudIntentLabel', 'Cloud'),
    configureLocal: translateAgentCenter(i18n, 'AgentCenter.aiConfig.configureLocalAction', 'Use Local'),
    configureCloud: translateAgentCenter(i18n, 'AgentCenter.aiConfig.configureCloudAction', 'Use Cloud'),
    notConfigured: translateAgentCenter(i18n, 'AgentCenter.aiConfig.notConfiguredLabel', 'Not configured'),
    saved: translateAgentCenter(i18n, 'AgentCenter.aiConfig.savedLabel', 'Configuration saved'),
    failed: translateAgentCenter(i18n, 'AgentCenter.aiConfig.saveFailedLabel', 'Configuration update failed'),
    cloudLoadFailed: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudLoadFailed', 'Cloud configuration choices could not be loaded.'),
    authorizationLoadFailed: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudAuthorizationLoadFailed', 'Account authorization choices could not be loaded. You may still save with no authorization selected.'),
    targetStep: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudTargetStep', '1. Confirm Cloud implementation and target'),
    implementation: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudImplementationLabel', 'Cloud implementation'),
    chooseImplementation: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudImplementationPlaceholder', 'Choose an existing implementation'),
    target: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudTargetLabel', 'Provider-model target'),
    chooseTarget: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudTargetPlaceholder', 'Choose an existing target'),
    confirmTarget: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudTargetConfirmation', 'I confirm this implementation and provider-model target.'),
    authorizationStep: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudAuthorizationStep', '2. Select account authorization'),
    authorization: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudAuthorizationLabel', 'Account authorization'),
    noAuthorization: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudAuthorizationNone', 'No authorization selected'),
    authorizationNeeded: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudAuthorizationNeeded', 'Account authorization still needs to be selected. You may save this information state and choose one later.'),
    authorizationRevoked: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudAuthorizationRevoked', 'The selected account authorization was revoked. Choose another authorization or save with none selected.'),
    grantActive: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudGrantActive', 'Active'),
    grantRevoked: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudGrantRevoked', 'Revoked'),
    connector: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudConnectorLabel', 'Create authorization from connector'),
    chooseConnector: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudConnectorPlaceholder', 'Choose a connector for this provider'),
    createGrant: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudCreateGrantAction', 'Create account authorization'),
    authorizationSeparation: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudAuthorizationSeparation', 'Authorization identifies the account only. It does not choose or change the implementation or target.'),
    sharedScope: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudSharedScopeConfirmation', 'I understand this Cloud choice applies to all LocalAgents and their proactive tasks.'),
    saveCloud: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudSaveAction', 'Save Cloud intent'),
    cancel: translateAgentCenter(i18n, 'AgentCenter.aiConfig.cloudCancelAction', 'Cancel'),
  }), [i18n]);

  const selectedImplementation = implementations.find((item) => item.optionId === implementationId) ?? null;
  const selectedTarget = targets.find((item) => item.targetId === targetId) ?? null;
  const selectedGrant = authorization.grants.find((item) => item.grantId === grantId) ?? null;
  const matchingConnectors = authorization.connectors.filter(
    (connector) => connector.provider === selectedImplementation?.provider,
  );
  const matchingGrants = authorization.grants.filter((grant) => (
    authorization.connectors.some((connector) => (
      connector.connectorId === grant.connectorId
      && connector.provider === selectedImplementation?.provider
    ))
  ));

  const configureLocalText = async () => {
    if (!projection || saving) return;
    const nextIntent = createNimiLocalAIConfigCapabilityIntent({
      capabilityContract: TEXT_GENERATE_CAPABILITY,
      requiredFeatures: [...(currentTextIntent?.requiredFeatures ?? [])],
      ...(currentTextIntent?.defaults
        ? { defaults: runtimeAIConfigStructToJson(currentTextIntent.defaults) }
        : {}),
    });
    await commitIntent(nextIntent);
  };

  const beginCloudConfiguration = async () => {
    if (!projection || !session.cloudAIConfig || cloudLoading) return;
    setCloudEditing(true);
    setCloudLoading(true);
    setCloudError('');
    setAuthorizationError('');
    setStatus('');
    setImplementations([]);
    setTargets([]);
    setAuthorization(EMPTY_AUTHORIZATION);
    setImplementationId('');
    setTargetId('');
    setGrantId(currentCloud?.connectorGrantId ?? '');
    setConnectorId('');
    setTargetConfirmed(false);
    setSharedScopeConfirmed(false);
    try {
      const listedImplementations = await session.cloudAIConfig.listImplementations(
        TEXT_GENERATE_CAPABILITY,
      );
      setImplementations(listedImplementations);
      setImplementationId(currentProvider && listedImplementations.some((item) => item.optionId === currentProvider)
        ? currentProvider
        : '');
      try {
        setAuthorization(await session.cloudAIConfig.listAuthorizationOptions());
      } catch {
        setAuthorizationError(labels.authorizationLoadFailed);
      }
    } catch {
      setCloudError(labels.cloudLoadFailed);
    } finally {
      setCloudLoading(false);
    }
  };

  useEffect(() => {
    if (!cloudEditing || !session.cloudAIConfig || !selectedImplementation) {
      setTargets([]);
      return;
    }
    let cancelled = false;
    setCloudLoading(true);
    setCloudError('');
    void session.cloudAIConfig.listTargets({
      capabilityContract: TEXT_GENERATE_CAPABILITY,
      provider: selectedImplementation.provider,
    }).then((listedTargets) => {
      if (cancelled) return;
      setTargets(listedTargets);
      if (
        currentProvider === selectedImplementation.provider
        && currentModelId
        && listedTargets.some((item) => item.targetId === targetOptionId(currentProvider, currentModelId))
      ) {
        setTargetId(targetOptionId(currentProvider, currentModelId));
      }
    }).catch(() => {
      if (!cancelled) setCloudError(labels.cloudLoadFailed);
    }).finally(() => {
      if (!cancelled) setCloudLoading(false);
    });
    return () => { cancelled = true; };
  }, [cloudEditing, currentModelId, currentProvider, labels.cloudLoadFailed, selectedImplementation, session.cloudAIConfig]);

  const createGrant = async () => {
    if (!session.cloudAIConfig || !connectorId || saving) return;
    setSaving(true);
    setCloudError('');
    try {
      const grant = await session.cloudAIConfig.createGrant(connectorId);
      const nextAuthorization = await session.cloudAIConfig.listAuthorizationOptions();
      setAuthorization(nextAuthorization);
      setGrantId(grant.grantId);
    } catch {
      setCloudError(labels.failed);
    } finally {
      setSaving(false);
    }
  };

  const saveCloud = async () => {
    if (
      !projection
      || !selectedImplementation
      || !selectedTarget
      || !targetConfirmed
      || !sharedScopeConfirmed
      || (grantId !== '' && selectedGrant?.status !== 'active')
    ) return;
    const nextIntent = createNimiCloudAIConfigCapabilityIntent({
      capabilityContract: TEXT_GENERATE_CAPABILITY,
      requiredFeatures: [...(currentTextIntent?.requiredFeatures ?? [])],
      ...(currentTextIntent?.defaults
        ? { defaults: runtimeAIConfigStructToJson(currentTextIntent.defaults) }
        : {}),
      implementation: selectedImplementation.implementation,
      providerModelTarget: selectedTarget.providerModelTarget,
      connectorGrantId: grantId || null,
    });
    if (await commitIntent(nextIntent)) setCloudEditing(false);
  };

  async function commitIntent(nextIntent: NimiCapabilityAIConfigIntent): Promise<boolean> {
    if (!projection || saving) return false;
    const capabilities = projection.aiConfig.capabilities
      .filter((intent) => intent.capabilityContract !== TEXT_GENERATE_CAPABILITY)
      .concat(nextIntent);
    setSaving(true);
    setStatus('');
    try {
      await session.overwriteSharedAIConfig({ capabilities });
      setStatus(labels.saved);
      return true;
    } catch {
      setStatus(labels.failed);
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (availability.state === 'unavailable') {
    return (
      <SectionShell labelledBy="agent-center-ai-config-title">
        <SectionHeader id="agent-center-ai-config-title" title={labels.title} description={labels.description} />
        <AgentCenterProductActionNotice
          action="overwriteSharedAIConfig"
          availability={availability}
          i18n={i18n}
          session={session}
        />
      </SectionShell>
    );
  }

  return (
    <SectionShell labelledBy="agent-center-ai-config-title">
      <SectionHeader
        id="agent-center-ai-config-title"
        title={labels.title}
        description={labels.description}
        right={(
          <div className="flex gap-2">
            <AgentButton
              disabled={!projection || saving}
              onClick={() => { void configureLocalText(); }}
              variant="primary"
            >
              {saving ? '…' : labels.configureLocal}
            </AgentButton>
            {session.cloudAIConfig ? (
              <AgentButton
                disabled={!projection || saving || cloudLoading}
                onClick={() => { void beginCloudConfiguration(); }}
                variant="default"
                dataAttrs={{ 'data-agent-center-cloud-start': true }}
              >
                {labels.configureCloud}
              </AgentButton>
            ) : null}
          </div>
        )}
      />

      {cloudEditing ? (
        <Card className="grid gap-4 p-3.5">
          <div className="grid gap-2.5">
            <div className="text-[12.5px] font-semibold text-slate-950">{labels.targetStep}</div>
            <label className="grid gap-1 text-[11.5px] font-semibold text-slate-600">
              <span>{labels.implementation}</span>
              <select
                aria-label={labels.implementation}
                className={agentCenterInputClassName}
                disabled={cloudLoading || saving}
                value={implementationId}
                onChange={(event) => {
                  setImplementationId(event.currentTarget.value);
                  setTargetId('');
                  setGrantId('');
                  setConnectorId('');
                  setTargetConfirmed(false);
                }}
              >
                <option value="">{labels.chooseImplementation}</option>
                {implementations.map((item) => (
                  <option key={item.optionId} value={item.optionId}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11.5px] font-semibold text-slate-600">
              <span>{labels.target}</span>
              <select
                aria-label={labels.target}
                className={agentCenterInputClassName}
                disabled={!selectedImplementation || cloudLoading || saving}
                value={targetId}
                onChange={(event) => {
                  setTargetId(event.currentTarget.value);
                  setTargetConfirmed(false);
                }}
              >
                <option value="">{labels.chooseTarget}</option>
                {targets.map((item) => (
                  <option key={item.targetId} value={item.targetId}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-2 text-[12px] leading-[1.4] text-slate-700">
              <input
                checked={targetConfirmed}
                disabled={!selectedImplementation || !selectedTarget || saving}
                onChange={(event) => setTargetConfirmed(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>{labels.confirmTarget}</span>
            </label>
          </div>

          <div className="border-t border-slate-200 pt-3.5 grid gap-2.5">
            <div className="text-[12.5px] font-semibold text-slate-950">{labels.authorizationStep}</div>
            <label className="grid gap-1 text-[11.5px] font-semibold text-slate-600">
              <span>{labels.authorization}</span>
              <select
                aria-label={labels.authorization}
                className={agentCenterInputClassName}
                disabled={!selectedImplementation || saving}
                value={grantId}
                onChange={(event) => setGrantId(event.currentTarget.value)}
              >
                <option value="">{labels.noAuthorization}</option>
                {matchingGrants.map((grant) => {
                  const connector = authorization.connectors.find((item) => item.connectorId === grant.connectorId);
                  return (
                    <option disabled={grant.status !== 'active'} key={grant.grantId} value={grant.grantId}>
                      {connector?.label || grant.connectorId} · {grant.status === 'active' ? labels.grantActive : labels.grantRevoked}
                    </option>
                  );
                })}
              </select>
            </label>
            {!grantId ? <Notice tone="info">{labels.authorizationNeeded}</Notice> : null}
            {grantId && selectedGrant?.status !== 'active' ? <Notice tone="warn">{labels.authorizationRevoked}</Notice> : null}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <select
                aria-label={labels.connector}
                className={agentCenterInputClassName}
                disabled={!selectedImplementation || saving}
                value={connectorId}
                onChange={(event) => setConnectorId(event.currentTarget.value)}
              >
                <option value="">{labels.chooseConnector}</option>
                {matchingConnectors.map((connector) => (
                  <option key={connector.connectorId} value={connector.connectorId}>{connector.label}</option>
                ))}
              </select>
              <AgentButton disabled={!connectorId || saving} onClick={() => { void createGrant(); }}>
                {labels.createGrant}
              </AgentButton>
            </div>
            <p className="m-0 text-[11.5px] leading-[1.4] text-slate-500">{labels.authorizationSeparation}</p>
          </div>

          <label className="flex items-start gap-2 rounded-[10px] border border-sky-200 bg-sky-50 p-2.5 text-[12px] font-medium leading-[1.4] text-sky-900">
            <input
              checked={sharedScopeConfirmed}
              onChange={(event) => setSharedScopeConfirmed(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>{labels.sharedScope}</span>
          </label>
          {authorizationError ? <Notice tone="warn">{authorizationError}</Notice> : null}
          {cloudError ? <Notice tone="warn">{cloudError}</Notice> : null}
          <div className="flex gap-2">
            <AgentButton
              disabled={
                saving
                || cloudLoading
                || !selectedImplementation
                || !selectedTarget
                || !targetConfirmed
                || !sharedScopeConfirmed
                || (grantId !== '' && selectedGrant?.status !== 'active')
              }
              onClick={() => { void saveCloud(); }}
              variant="primary"
              dataAttrs={{ 'data-agent-center-cloud-save': true }}
            >
              {saving ? '…' : labels.saveCloud}
            </AgentButton>
            <AgentButton onClick={() => setCloudEditing(false)} variant="ghost">{labels.cancel}</AgentButton>
          </div>
        </Card>
      ) : null}

      {projection ? (
        <Card>
          <div className="divide-y divide-slate-100">
            {projection.aiConfig.capabilities.length > 0 ? projection.aiConfig.capabilities.map((intent) => {
              const local = intent.route.oneofKind === 'local';
              const cloudGrantMissing = intent.route.oneofKind === 'cloud' && !intent.route.cloud.connectorGrantId;
              return (
                <div
                  className="flex min-w-0 items-center justify-between gap-3 px-3.5 py-3"
                  data-agent-center-capability-intent={intent.capabilityContract}
                  key={intent.capabilityContract}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-slate-950">
                      {intent.capabilityContract}
                    </div>
                    {intent.requiredFeatures.length > 0 ? (
                      <div className="mt-0.5 truncate text-[11.5px] text-slate-500">
                        {intent.requiredFeatures.join(', ')}
                      </div>
                    ) : null}
                    {cloudGrantMissing ? (
                      <div className="mt-0.5 text-[11.5px] text-sky-700">{labels.authorizationNeeded}</div>
                    ) : null}
                  </div>
                  <StatusPill tone={local ? 'ready' : 'muted'} label={local ? labels.local : labels.cloud} />
                </div>
              );
            }) : (
              <div className="px-3.5 py-3 text-[12.5px] text-slate-500">{labels.notConfigured}</div>
            )}
          </div>
        </Card>
      ) : <Notice tone="warn">{labels.notConfigured}</Notice>}
      {status ? <Notice ariaLive="polite" tone={status === labels.failed ? 'warn' : 'info'}>{status}</Notice> : null}
    </SectionShell>
  );
}

function targetOptionId(provider: string, model: string): string {
  return JSON.stringify([provider, model]);
}

function jsonText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
