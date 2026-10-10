import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ConfirmDialog,
  InlineAlert,
  LoadingSkeleton,
  Surface,
  ScrollArea,
  OverlayShell,
  SelectField,
  StatusBadge,
} from '@nimiplatform/kit/ui';
import type {
  NimiIntegrationConsumer,
  NimiIntegrationManagement,
  NimiIntegrationConnectionConfig,
  NimiIntegrationConnectionSetup,
  NimiIntegrationTarget,
  NimiIntegrationPermission,
} from '@nimiplatform/sdk/app';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import { integrationErrorCode, integrationErrorTranslationKey } from './integration-error.js';
import { IntegrationSetupQr } from './integration-setup-qr.js';
import { integrationSetupPending, observeIntegrationSetup } from './integration-setup-observer.js';
import { ArrowLeft, Check, Plus, QrCode, RefreshCw, ShieldCheck, X } from 'lucide-react';
import {
  IntegrationSidebar,
  IntegrationServiceIcon,
  INTEGRATION_SERVICES,
  serviceLabel,
  type IntegrationTab,
} from './integration-workspace.js';
import { IntegrationCallsView } from './integration-calls-view.js';
import { IntegrationPermissionsView } from './integration-permissions-view.js';
import { IntegrationConsumerDetails } from './integration-consumer-details.js';
import { IntegrationSettingsView, integrationAvailabilityKey } from './integration-settings-view.js';
import { integrationOperationIcon, integrationOperationPresentation } from './integration-operation-presentation.js';

const fieldClass =
  'w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]';
// SelectField drops empty-string options (Radix reserves '' for the
// placeholder), so the cleared connection choice uses a sentinel value.
const NO_TARGET_OPTION_VALUE = '__no_target__';
const permissionCardClass = (selected: boolean) =>
  `rounded-xl border transition-colors ${
    selected
      ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))]'
      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-action-primary-bg)]/60'
  }`;
const permissionCheckClass =
  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] text-transparent transition-[background-color,border-color,color] peer-checked:border-[var(--nimi-action-primary-bg)] peer-checked:bg-[var(--nimi-action-primary-bg)] peer-checked:text-[var(--nimi-action-primary-text)] peer-focus-visible:ring-[length:var(--nimi-focus-ring-width)] peer-focus-visible:ring-[var(--nimi-focus-ring-color)]';
type PermissionIntent = Readonly<{
  target: NimiIntegrationTarget;
  consumers: readonly string[];
  operations: readonly string[];
}>;

// @nimi-authority: rule.nimi.runtime.integration.fixed-operations
// Home projects Runtime-owned connection and standing resource policy. Merely
// displaying this form or declaring integration.manage grants no authority.
// @nimi-authority: rule.nimi.runtime.integration.qq-onebot-protocol
export function IntegrationsPanel({
  onBack,
  appIconUrls,
}: {
  onBack: () => void;
  appIconUrls?: ReadonlyMap<string, string | null>;
}) {
  const { t, i18n } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const [snapshot, setSnapshot] = useState<NimiIntegrationManagement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [service, setService] = useState('mcp');
  const [tab, setTab] = useState<IntegrationTab>('permissions');
  const [setupOpen, setSetupOpen] = useState(false);
  const [cancelingSetup, setCancelingSetup] = useState(false);
  const cancelingSetupRef = useRef(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [editingConsumerRef, setEditingConsumerRef] = useState('');
  const initialized = useRef(false);
  const [adapter, setAdapter] = useState('mcp');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [appId, setAppId] = useState('');
  const [feishuMode, setFeishuMode] = useState<'manual' | 'create'>('manual');
  const [listener, setListener] = useState('127.0.0.1:6700');
  const [selfId, setSelfId] = useState('');
  const [setup, setSetup] = useState<NimiIntegrationConnectionSetup | null>(null);
  const [expiredSetupId, setExpiredSetupId] = useState('');
  const expiredSetupRef = useRef('');
  const runVersion = useRef(0);
  const setupActive = Boolean(
    setup && setup.setupId !== expiredSetupId && integrationSetupPending(setup.status),
  );
  const [refreshRef, setRefreshRef] = useState('');
  const verificationCode = useRef<HTMLInputElement>(null);
  const setupRef = useRef<NimiIntegrationConnectionSetup | null>(null);
  setupRef.current = setup;
  const secret = useRef<HTMLInputElement>(null);
  const resetSetupInputs = () => {
    if (secret.current) secret.current.value = '';
    if (verificationCode.current) verificationCode.current.value = '';
    runVersion.current++;
    setupRef.current = null;
    expiredSetupRef.current = '';
    setSetup(null);
    setExpiredSetupId('');
    setError('');
    setNotice('');
  };
  const [targetRef, setTargetRef] = useState('');
  const editorVersion = useRef(0);
  const setupEditorVersion = useRef(0);
  const editorTarget = useRef('');
  const setupMaySelect = useRef(false);
  const [consumers, setConsumers] = useState<string[]>([]);
  const [operations, setOperations] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<
    | { readonly kind: 'remove'; readonly targetRef: string; readonly name: string }
    | {
        readonly kind: 'narrow';
        readonly intent: PermissionIntent;
        readonly changes: readonly { readonly app: string; readonly removed: readonly string[] }[];
      }
    | {
        readonly kind: 'revoke';
        readonly permission: NimiIntegrationPermission;
        readonly app: string;
        readonly service: string;
      }
    | null
  >(null);
  const selectTarget = (value: string) => {
    editorVersion.current++;
    editorTarget.current = value;
    setTargetRef(value);
    setPermissionOpen(false);
    setConsumers([]);
    setOperations([]);
    setConfirming(null);
  };
  const active = useRef(true);
  const load = useCallback(async () => {
    const data = await sdk.appProduct().integration.getManagement();
    if (active.current) setSnapshot(data);
  }, [sdk]);
  const showError = (cause: unknown) => {
    if (!active.current) return;
    const code = integrationErrorCode(cause);
    setError(
      code
        ? t(integrationErrorTranslationKey(code, adapter), { defaultValue: t('Integrations.unavailable') })
        : t('Integrations.unavailable'),
    );
  };
  // Mutation replies belong to one request and one setup. React state updates
  // alone cannot provide this fence because a second reply may arrive before
  // React has committed the first update.
  const applySetupReply = useCallback(
    (next: NimiIntegrationConnectionSetup, version: number, expectedId?: string) => {
      if (!active.current || runVersion.current !== version) return false;
      if (
        expectedId &&
        (setupRef.current?.setupId !== expectedId ||
          next.setupId !== expectedId ||
          expiredSetupRef.current === expectedId)
      )
        return false;
      const deadline = Date.parse(next.expiresAt || '');
      const currentDeadline = expectedId ? Date.parse(setupRef.current?.expiresAt || '') : deadline;
      if (
        !Number.isFinite(deadline) ||
        !Number.isFinite(currentDeadline) ||
        Date.now() >= Math.min(deadline, currentDeadline)
      )
        return false;
      const originalTargetRef = setupRef.current?.targetRef || '';
      setupRef.current = next;
      setSetup(next);
      if (next.status === 'completed') {
        const changedTarget = next.targetRef !== originalTargetRef;
        if (setupMaySelect.current && editorVersion.current === setupEditorVersion.current) {
          if (changedTarget) selectTarget(next.targetRef);
          else if (editorTarget.current !== next.targetRef) selectTarget(next.targetRef);
        }
        if (changedTarget) {
          setRefreshRef('');
          setName('');
        }
        setNotice(
          t(
            originalTargetRef && changedTarget
              ? 'Integrations.newConnectionCreated'
              : 'Integrations.connected',
          ),
        );
        void load().catch(showError);
      }
      if (next.status === 'already-bound') {
        if (
          setupMaySelect.current &&
          editorVersion.current === setupEditorVersion.current &&
          editorTarget.current !== next.targetRef
        )
          selectTarget(next.targetRef);
        setNotice(t('Integrations.alreadyBound'));
        void load().catch(showError);
      }
      return true;
    },
    [load, t],
  );
  useEffect(() => {
    active.current = true;
    void load().catch(showError);
    return () => {
      runVersion.current++;
      active.current = false;
      if (secret.current) secret.current.value = '';
      if (verificationCode.current) verificationCode.current.value = '';
      const pending = setupRef.current;
      if (pending && integrationSetupPending(pending.status))
        void sdk
          .appProduct()
          .integration.cancelConnectionSetup({ setupId: pending.setupId })
          .catch(() => {});
      setupRef.current = null;
    };
  }, [load]);
  useEffect(() => {
    if (!setup || !setupActive || cancelingSetup) return;
    return observeIntegrationSetup({
      setup,
      query: () => sdk.appProduct().integration.getConnectionSetup({ setupId: setup.setupId }),
      update: (next) => {
        if (cancelingSetupRef.current) return;
        if (!applySetupReply(next, runVersion.current, setup.setupId)) return;
      },
      error: (cause) => {
        if (!cancelingSetupRef.current) showError(cause);
      },
      expired: () => {
        if (!active.current || cancelingSetupRef.current) return;
        runVersion.current++;
        setBusy(false);
        setExpiredSetupId(setup.setupId);
        expiredSetupRef.current = setup.setupId;
        if (setupRef.current?.setupId === setup.setupId)
          setupRef.current = { ...setupRef.current, verificationUrl: '' };
        setSetup((current) =>
          current?.setupId === setup.setupId ? { ...current, verificationUrl: '' } : current,
        );
        if (verificationCode.current) verificationCode.current.value = '';
        if (secret.current) secret.current.value = '';
      },
    });
  }, [setup, setupActive, cancelingSetup, sdk, load, t, applySetupReply]);
  const run = async (action: (version: number) => Promise<void>) => {
    const version = ++runVersion.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action(version);
      if (version === runVersion.current) await load();
    } catch (cause) {
      if (version === runVersion.current) {
        showError(cause);
        await load().catch(() => {});
      }
    } finally {
      if (active.current && version === runVersion.current) setBusy(false);
    }
  };
  const target = snapshot?.targets.find((item) => item.targetRef === targetRef);
  const describeSource = (app: NimiIntegrationConsumer | undefined) =>
    t(`Integrations.sourceKinds.${app?.sourceKind || 'unknown'}`);
  const sourceTone = (app: NimiIntegrationConsumer | undefined): 'neutral' | 'success' | 'info' =>
    app?.sourceKind === 'platform' ? 'success' : app?.sourceKind === 'installed' ? 'info' : 'neutral';
  const toggle = (values: string[], value: string) =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  // Editing replaces one consumer's allowed set; adding only offers ungranted consumers.
  const allowedFor = (consumerRef: string) =>
    snapshot?.permissions.find((item) => item.consumerRef === consumerRef && item.targetRef === targetRef)
      ?.operations ?? [];
  const toggleConsumer = (consumerRef: string) => {
    setConsumers((current) => toggle(current, consumerRef));
  };
  const permissionConsumers = snapshot?.consumers.filter((app) =>
    editingConsumerRef
      ? app.consumerRef === editingConsumerRef
      : allowedFor(app.consumerRef).length === 0,
  ) ?? [];
  const appName = (consumerRef: string) => {
    const app = snapshot?.consumers.find((item) => item.consumerRef === consumerRef);
    return app?.displayName || app?.appId || t('Integrations.unavailableApp');
  };
  const savePermissions = (intent: PermissionIntent) =>
    run(async () => {
      for (const consumerRef of intent.consumers)
        await sdk
          .appProduct()
          .integration.setPermission({
            consumerRef,
            targetRef: intent.target.targetRef,
            operations: [...intent.operations],
          });
      setPermissionOpen(false);
      setNotice(t('Integrations.allowed'));
    });
  const requestSave = () => {
    if (!target || !consumers.length || (!editingConsumerRef && !operations.length)) return;
    const intent: PermissionIntent = Object.freeze({
      target,
      consumers: Object.freeze([...consumers]),
      operations: Object.freeze([...operations]),
    });
    const changes = consumers
      .map((consumerRef) => ({
        app: appName(consumerRef),
        removed: allowedFor(consumerRef).filter((op) => !operations.includes(op)),
      }))
      .filter((change) => change.removed.length > 0);
    if (changes.length > 0) setConfirming({ kind: 'narrow', intent, changes });
    else void savePermissions(intent);
  };
  const removeConnection = (removeRef: string) =>
    run(async () => {
      await sdk.appProduct().integration.removeConnection({ targetRef: removeRef });
      if (active.current) {
        selectTarget('');
        setNotice(t('Integrations.removed'));
      }
    });
  const callTime = (value: string | null) =>
    value ? new Date(value).toLocaleString(i18n.language) : t('Integrations.unknownTime');
  const operationName = (name: string, source = target) => {
    const op = source?.operations.find((item) => item.name === name);
    return op && source ? integrationOperationPresentation(source.kind, op, t).name : name;
  };
  const connect = async (version: number) => {
    setupEditorVersion.current = editorVersion.current;
    setupMaySelect.current = !refreshRef || editorTarget.current === refreshRef;
    const credential = secret.current?.value ?? '';
    if (secret.current) secret.current.value = '';
    const config: NimiIntegrationConnectionConfig =
      adapter === 'mcp'
        ? { mcp: { endpoint: endpoint.trim() } }
        : adapter === 'telegram'
          ? { telegram: {} }
          : adapter === 'weixin'
            ? { weixin: {} }
            : adapter === 'feishu'
              ? feishuMode === 'create'
                ? { feishu: { setupMode: 'create' } }
                : { feishu: { setupMode: 'manual', appId: appId.trim() } }
              : adapter === 'qq-official'
                ? { qqOfficial: { appId: appId.trim() } }
                : { onebotV11: { listener: listener.trim(), selfId: selfId.trim() } };
    const started = await sdk
      .appProduct()
      .integration.startConnectionSetup({
        targetRef: refreshRef,
        adapter,
        ...(adapter === 'weixin' ? {} : { displayName: name.trim() }),
        accountLabel: '',
        config,
      });
    if (!applySetupReply(started, version)) {
      if (integrationSetupPending(started.status))
        await sdk
          .appProduct()
          .integration.cancelConnectionSetup({ setupId: started.setupId })
          .catch(() => {});
      return;
    }
    if (started.status === 'awaiting-input' && adapter !== 'weixin') {
      const submitted = await sdk
        .appProduct()
        .integration.submitConnectionSetup({
          setupId: started.setupId,
          secret: credential,
          verificationCode: '',
        });
      applySetupReply(submitted, version, started.setupId);
    }
  };
  const submitVerification = () => {
    const code = verificationCode.current?.value || '';
    if (!/^[0-9]{1,32}$/u.test(code)) {
      setError(t('Integrations.verificationInvalid'));
      verificationCode.current?.focus();
      return;
    }
    void run(async (version) => {
      if (verificationCode.current) verificationCode.current.value = '';
      const next = await sdk
        .appProduct()
        .integration.submitConnectionSetup({ setupId: setup!.setupId, secret: '', verificationCode: code });
      applySetupReply(next, version, setup!.setupId);
    });
  };
  useEffect(() => {
    if (!snapshot) return;
    if (!initialized.current) {
      initialized.current = true;
      const first =
        INTEGRATION_SERVICES.flatMap((kind) => snapshot.targets.filter((item) => item.kind === kind))[0] ||
        snapshot.targets[0];
      if (first) {
        setService(first.kind);
        selectTarget(first.targetRef);
      }
    } else if (
      target &&
      service !== 'all-calls' &&
      service !== 'all-permissions' &&
      target.kind !== service
    ) {
      setService(target.kind);
    }
  }, [snapshot, target, service]);
  const serviceTargets = snapshot?.targets.filter((item) => item.kind === service) || [];
  const selectService = (kind: string) => {
    initialized.current = true;
    selectTarget(snapshot?.targets.find((item) => item.kind === kind)?.targetRef || '');
    setService(kind);
    setTab('permissions');
    setError('');
    setNotice('');
  };
  const openConnection = (refresh = false) => {
    resetSetupInputs();
    setRefreshRef(refresh && target ? target.targetRef : '');
    setAdapter(refresh && target ? target.kind : service === 'app' ? 'mcp' : service);
    setName(refresh && target ? target.displayName : '');
    setAppId('');
    setEndpoint('');
    setSelfId('');
    setListener(refresh ? '' : '127.0.0.1:6700');
    setFeishuMode('manual');
    setSetupOpen(true);
  };
  const closeConnection = () => {
    if (busy || cancelingSetupRef.current) return;
    // Closing a live setup is an explicit cancellation, never an implicit success.
    if (setupActive && setup) {
      const version = ++runVersion.current;
      cancelingSetupRef.current = true;
      setCancelingSetup(true);
      setBusy(true);
      setError('');
      setNotice('');
      void (async () => {
        try {
          const next = await sdk.appProduct().integration.cancelConnectionSetup({ setupId: setup.setupId });
          if (!active.current || version !== runVersion.current) return;
          if (next.setupId !== setup.setupId) throw new Error('Unexpected setup cancellation reply');
          if (next.status === 'canceled') {
            resetSetupInputs();
            setSetupOpen(false);
            setNotice(t('Integrations.connectionCanceled'));
          } else {
            applySetupReply(next, version, setup.setupId);
            setError(t('Integrations.cancelNotCompleted'));
          }
        } catch {
          if (active.current && version === runVersion.current) setError(t('Integrations.cancelFailed'));
        } finally {
          cancelingSetupRef.current = false;
          if (active.current) {
            setCancelingSetup(false);
            setBusy(false);
          }
        }
      })();
    } else {
      resetSetupInputs();
      setSetupOpen(false);
    }
  };
  const editPermission = (permission?: NimiIntegrationPermission) => {
    if (permission) {
      const source = snapshot?.targets.find((item) => item.targetRef === permission.targetRef);
      if (!source) return;
      selectTarget(source.targetRef);
      setService(source.kind);
      setTab('permissions');
      setConsumers([permission.consumerRef]);
      setOperations([...permission.operations]);
    } else {
      setConsumers([]);
      setOperations([]);
    }
    setEditingConsumerRef(permission?.consumerRef ?? '');
    setError('');
    setNotice('');
    setPermissionOpen(true);
  };
  const revokePermission = (permission: NimiIntegrationPermission) => {
    const app =
      snapshot?.consumers.find((item) => item.consumerRef === permission.consumerRef) ||
      permission.consumer ||
      undefined;
    const source = snapshot?.targets.find((item) => item.targetRef === permission.targetRef);
    setConfirming({
      kind: 'revoke',
      permission,
      app: app?.displayName || app?.appId || t('Integrations.unavailableApp'),
      service: source ? serviceLabel(source.kind, t) : '',
    });
  };
  // A permission whose source disappeared must remain revocable from the all-permissions view.
  const performRevoke = (permission: NimiIntegrationPermission) =>
    run(async () => {
      await sdk
        .appProduct()
        .integration.setPermission({
          consumerRef: permission.consumerRef,
          targetRef: permission.targetRef,
          operations: [],
        });
    });
  const allCalls = service === 'all-calls';
  const allPermissions = service === 'all-permissions';
  const canConnect =
    INTEGRATION_SERVICES.includes(service as (typeof INTEGRATION_SERVICES)[number]) && service !== 'app';
  const staleOperations = [...new Set(consumers.flatMap((ref) => allowedFor(ref)))].filter(
    (name) => !target?.operations.some((op) => op.name === name),
  );
  const refreshManagement = () => {
    void run(load);
  };
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-3 pb-3 pt-2 lg:flex-row"
      data-testid="integrations-panel"
    >
      <IntegrationSidebar
        targets={snapshot?.targets || []}
        selected={service}
        onSelect={selectService}
        disabled={busy}
      />
      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-xl border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-base)]"
      >
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName="bg-transparent"
          contentClassName="px-5 py-6 sm:px-7"
        >
          <Button tone="ghost" size="sm" onClick={onBack} leadingIcon={<ArrowLeft size={15} />}>
            {t('Integrations.back')}
          </Button>
          <header className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <IntegrationServiceIcon kind={service} large />
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold">
                  {allCalls
                    ? t('Integrations.allCalls')
                    : allPermissions
                      ? t('Integrations.allPermissions')
                      : serviceLabel(service, t)}
                </h1>
                {!allCalls && !allPermissions && serviceTargets.length ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-[var(--nimi-text-secondary)]">
                      {t('Integrations.currentConnection')}
                      <SelectField
                        data-testid="integration-target"
                        aria-label={t('Integrations.currentConnection')}
                        className="w-auto max-w-full sm:max-w-96"
                        selectClassName="text-sm"
                        options={[
                          { value: NO_TARGET_OPTION_VALUE, label: t('Integrations.selectTarget') },
                          ...serviceTargets.map((item) => ({
                            value: item.targetRef,
                            label:
                              item.accountLabel && !item.displayName.includes(item.accountLabel)
                                ? `${item.displayName} · ${item.accountLabel}`
                                : item.displayName,
                          })),
                        ]}
                        value={targetRef || NO_TARGET_OPTION_VALUE}
                        onValueChange={(next) => selectTarget(next === NO_TARGET_OPTION_VALUE ? '' : next)}
                        disabled={busy}
                      />
                    </div>
                    {target?.available ? (
                      <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,transparent)] px-2 py-1 text-xs text-[var(--nimi-status-success)]">
                        {t('Integrations.available')}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canConnect ? (
                <Button
                  data-testid="integration-add-connection"
                  tone="secondary"
                  size="sm"
                  disabled={busy || setupActive}
                  leadingIcon={<Plus size={15} />}
                  onClick={() => openConnection()}
                >
                  {t('Integrations.addConnection')}
                </Button>
              ) : null}
              <Button
                tone="ghost"
                size="sm"
                disabled={busy}
                aria-label={t('Integrations.refresh')}
                onClick={refreshManagement}
              >
                <RefreshCw size={15} />
              </Button>
            </div>
          </header>
          <div className="mt-4 space-y-3" aria-live="polite">
            {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
            {notice ? <InlineAlert tone="info">{notice}</InlineAlert> : null}
            {target && !target.available && tab !== 'settings' ? (
              <InlineAlert tone="info">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>{t(integrationAvailabilityKey(target))}</span>
                  <Button tone="secondary" size="sm" onClick={() => setTab('settings')}>
                    {t('Integrations.connectionInfo')}
                  </Button>
                </div>
              </InlineAlert>
            ) : null}
          </div>
          {!allCalls && !allPermissions ? (
            <div
              className="mt-5 flex gap-6 border-b border-[var(--nimi-border-subtle)]"
              role="tablist"
              aria-label={t('Integrations.title')}
            >
              {(['permissions', 'calls', 'settings'] as const).map((item) => (
                <button
                  type="button"
                  key={item}
                  id={`integration-tab-${item}`}
                  role="tab"
                  aria-selected={tab === item}
                  aria-controls="integration-content"
                  onClick={() => setTab(item)}
                  onKeyDown={(event) => {
                    const tabs = ['permissions', 'calls', 'settings'] as const;
                    const index = tabs.indexOf(item);
                    const next =
                      event.key === 'ArrowRight'
                        ? (index + 1) % 3
                        : event.key === 'ArrowLeft'
                          ? (index + 2) % 3
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? 2
                              : -1;
                    if (next >= 0) {
                      event.preventDefault();
                      setTab(tabs[next]!);
                      document.getElementById(`integration-tab-${tabs[next]}`)?.focus();
                    }
                  }}
                  tabIndex={tab === item ? 0 : -1}
                  className={`border-b-2 pb-3 pt-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${tab === item ? 'border-[var(--nimi-action-primary-bg)] font-medium text-[var(--nimi-action-primary-bg)]' : 'border-transparent text-[var(--nimi-text-secondary)]'}`}
                >
                  {t(
                    `Integrations.${{ permissions: 'applicationPermissions', calls: 'usageRecords', settings: 'connectionInfo' }[item]}`,
                  )}
                </button>
              ))}
            </div>
          ) : null}
          <div
            id="integration-content"
            className="mt-6"
            role={!allCalls && !allPermissions ? 'tabpanel' : undefined}
            aria-labelledby={!allCalls && !allPermissions ? `integration-tab-${tab}` : undefined}
          >
            {!snapshot ? (
              error ? (
                <Button tone="secondary" disabled={busy} onClick={refreshManagement}>
                  {t('Integrations.refresh')}
                </Button>
              ) : (
                <LoadingSkeleton lines={4} label={t('Common.loading')} />
              )
            ) : allCalls ? (
              <IntegrationCallsView
                key="all"
                calls={snapshot.calls}
                targets={snapshot.targets}
                busy={busy}
                refresh={refreshManagement}
                global
              />
            ) : allPermissions ? (
              <IntegrationPermissionsView
                appIconUrls={appIconUrls}
                snapshot={snapshot}
                all
                busy={busy}
                onAdd={() => editPermission()}
                onEdit={editPermission}
                onRevoke={revokePermission}
              />
            ) : !target ? (
              <div className="py-14 text-center">
                <h2 className="text-lg font-semibold">
                  {t(
                    serviceTargets.length
                      ? 'Integrations.selectExistingTarget'
                      : 'Integrations.noServiceConnection',
                    { service: serviceLabel(service, t) },
                  )}
                </h2>
                <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[var(--nimi-text-secondary)]">
                  {t(service === 'app' ? 'Integrations.appProviderHelp' : 'Integrations.description')}
                </p>
                {canConnect ? (
                  <Button
                    className="mt-5"
                    tone="primary"
                    disabled={busy || setupActive}
                    onClick={() => openConnection()}
                  >
                    {t('Integrations.connect')}
                  </Button>
                ) : null}
              </div>
            ) : tab === 'calls' ? (
              <IntegrationCallsView
                key={target.targetRef}
                calls={snapshot.calls.filter((call) => call.targetRef === target.targetRef)}
                targets={snapshot.targets}
                busy={busy}
                refresh={refreshManagement}
              />
            ) : tab === 'settings' ? (
              <IntegrationSettingsView
                target={target}
                busy={busy}
                setupActive={setupActive}
                onRecheck={refreshManagement}
                onRefresh={() => openConnection(true)}
                onVerify={() =>
                  void run(async () => {
                    await sdk
                      .appProduct()
                      .integration.putConnection({
                        targetRef: target.targetRef,
                        adapter: 'telegram',
                        config: { telegram: {} },
                        displayName: target.displayName,
                        accountLabel: target.accountLabel,
                        secret: '',
                      });
                    setNotice(t('Integrations.verified'));
                  })
                }
                onRemove={() =>
                  setConfirming({ kind: 'remove', targetRef: target.targetRef, name: target.displayName })
                }
              />
            ) : (
              <IntegrationPermissionsView
                appIconUrls={appIconUrls}
                snapshot={snapshot}
                target={target}
                busy={busy}
                onAdd={() => editPermission()}
                onEdit={editPermission}
                onRevoke={revokePermission}
              />
            )}
          </div>
        </ScrollArea>
      </Surface>
      <OverlayShell
        open={setupOpen}
        kind="drawer"
        size="sm"
        closeOnBackdrop
        onClose={closeConnection}
        title={
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2.5">
              <IntegrationServiceIcon kind={adapter} />
              <span className="truncate">
                {t(refreshRef ? 'Integrations.refreshServiceConnection' : 'Integrations.connectService', {
                  service: serviceLabel(adapter, t),
                })}
              </span>
            </span>
            <Button
              tone="ghost"
              size="sm"
              aria-label={t('Integrations.close')}
              disabled={busy}
              onClick={closeConnection}
            >
              <X size={18} />
            </Button>
          </div>
        }
        description={
          <p className="text-sm font-normal text-[var(--nimi-text-secondary)]">
            {t(setupActive ? 'Integrations.closeSetupHelp' : 'Integrations.connectionSetupHelp')}
          </p>
        }
        panelClassName="flex flex-col"
        contentClassName="flex min-h-0 flex-1 flex-col !p-0"
        data-testid="integration-connection-drawer"
      >
        <ScrollArea className="min-h-0 flex-1" contentClassName="px-6 py-2 pb-6">
          {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
          {notice ? <InlineAlert tone="info">{notice}</InlineAlert> : null}
          {refreshRef ? (
            <>
              {adapter !== 'weixin' ? (
                <div className="mt-3">
                  <InlineAlert tone="info">{t('Integrations.stopOperationsHelp')}</InlineAlert>
                </div>
              ) : null}
              <p className="mt-2 text-sm">
                {t(
                  adapter === 'weixin' ? 'Integrations.weixinRefreshHelp' : 'Integrations.refreshIdentityHelp',
                )}
              </p>
              <Button
                className="mt-2"
                tone="secondary"
                disabled={busy || setupActive}
                onClick={() => {
                  resetSetupInputs();
                  setRefreshRef('');
                }}
              >
                {t('Integrations.addInstead')}
              </Button>
            </>
          ) : null}
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(connect);
            }}
          >
            {adapter !== 'weixin' ? (
              <label className="flex flex-col gap-1.5 text-sm">
                {t('Integrations.name')}
                <input
                  className={fieldClass}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t(
                    adapter === 'feishu' ? 'Integrations.feishuNamePlaceholder' : 'Integrations.namePlaceholder',
                  )}
                  maxLength={256}
                  required
                  disabled={busy}
                />
              </label>
            ) : refreshRef || setupActive ? null : (
              <div className="rounded-xl border border-[var(--nimi-border-subtle)] p-4">
                <p className="text-sm font-medium">{t('Integrations.weixinStepsTitle')}</p>
                <ol className="mt-3 flex flex-col gap-2.5">
                  {(['weixinStepGenerate', 'weixinStepScan'] as const).map((key, index) => (
                    <li key={key} className="flex items-start gap-2.5 text-sm">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--nimi-surface-active)] text-xs font-medium text-[var(--nimi-action-primary-bg)]">
                        {index + 1}
                      </span>
                      <span className="leading-5 text-[var(--nimi-text-secondary)]">
                        {t(`Integrations.${key}`)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {adapter === 'mcp' ? (
              <label className="flex flex-col gap-1.5 text-sm">
                {t('Integrations.endpoint')}
                <input
                  className={fieldClass}
                  type="url"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder={t('Integrations.endpointPlaceholder')}
                  required
                  disabled={busy}
                />
              </label>
            ) : null}
            {adapter === 'feishu' ? (
              <label className="flex flex-col gap-1.5 text-sm">
                {t('Integrations.feishuSetup')}
                <SelectField
                  data-testid="integration-feishu-mode"
                  aria-label={t('Integrations.feishuSetup')}
                  value={feishuMode}
                  contentLayer="dialog"
                  options={[
                    { value: 'manual', label: t('Integrations.feishuManual') },
                    { value: 'create', label: t('Integrations.feishuCreate') },
                  ]}
                  onValueChange={(next) => {
                    if (next === feishuMode || (next !== 'manual' && next !== 'create')) return;
                    resetSetupInputs();
                    setFeishuMode(next);
                  }}
                  disabled={busy || Boolean(refreshRef) || setupActive}
                />
              </label>
            ) : null}
            {(adapter === 'feishu' && feishuMode === 'manual') || adapter === 'qq-official' ? (
              <label className="flex flex-col gap-1.5 text-sm">
                {t('Integrations.appId')}
                <input
                  className={fieldClass}
                  value={appId}
                  onChange={(event) => setAppId(event.target.value)}
                  maxLength={256}
                  required
                  disabled={busy}
                />
              </label>
            ) : null}
            {adapter === 'onebot-v11' ? (
              <>
                <label className="flex flex-col gap-1.5 text-sm">
                  {t('Integrations.listener')}
                  <input
                    className={fieldClass}
                    value={listener}
                    onChange={(event) => setListener(event.target.value)}
                    maxLength={256}
                    required
                    disabled={busy}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  {t('Integrations.selfId')}
                  <input
                    className={fieldClass}
                    value={selfId}
                    onChange={(event) => setSelfId(event.target.value)}
                    maxLength={256}
                    required
                    disabled={busy}
                  />
                </label>
              </>
            ) : null}
            {adapter !== 'weixin' && !(adapter === 'feishu' && feishuMode === 'create') ? (
              <label className="flex flex-col gap-1.5 text-sm">
                {t(
                  adapter === 'telegram'
                    ? 'Integrations.botToken'
                    : ['feishu', 'qq-official'].includes(adapter)
                      ? 'Integrations.appSecret'
                      : adapter === 'onebot-v11'
                        ? 'Integrations.requiredToken'
                        : 'Integrations.bearerToken',
                )}
                <input
                  key={`${adapter}:${feishuMode}:${refreshRef}`}
                  ref={secret}
                  className={fieldClass}
                  type="password"
                  autoComplete="off"
                  required={adapter !== 'mcp'}
                  disabled={busy}
                />
              </label>
            ) : null}
            {adapter === 'feishu' ? (
              <div className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
                <p>{t('Integrations.feishuManualHelp')}</p>
                <details className="mt-2">
                  <summary>{t('Integrations.operationDetails')}</summary>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {(
                      t('Integrations.feishuScopeHelp', { returnObjects: true }) as unknown as readonly {
                        label: string;
                        scope: string;
                      }[]
                    ).map((item) => (
                      <li key={item.scope} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="shrink-0">{item.label}</span>
                        <code className="break-all rounded bg-[var(--nimi-surface-active)] px-1.5 py-0.5 text-[11px]">
                          {item.scope}
                        </code>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : null}
            {adapter === 'telegram' ? (
              <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
                {t('Integrations.telegramMode')}
              </p>
            ) : null}
            {adapter === 'qq-official' ? (
              <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
                {t('Integrations.qqMode')}
              </p>
            ) : null}
            {adapter === 'onebot-v11' ? (
              <div className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
                <p>{t('Integrations.onebotMode')}</p>
                <details className="mt-2">
                  <summary>{t('Integrations.operationDetails')}</summary>
                  <p className="mt-2">{t('Integrations.onebotProtocolHelp')}</p>
                </details>
              </div>
            ) : null}
            {setup ? (
              <div
                className="rounded-xl border border-[var(--nimi-border-subtle)] p-4 text-sm"
                data-testid="integration-setup"
              >
                <p className="font-medium">
                  {setup.setupId === expiredSetupId
                    ? t('Integrations.setupObservationExpired')
                    : setupActive && setup.adapter === 'weixin' && setup.status === 'awaiting-confirmation'
                      ? t('Integrations.weixinScanConfirm')
                      : t(`Integrations.setupStates.${setup.status}`)}
                </p>
                {setupActive ? (
                  <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
                    {t('Integrations.setupExpires', { time: callTime(setup.expiresAt) })}
                  </p>
                ) : null}
                {setup.accountLabel ? <p className="mt-1">{setup.accountLabel}</p> : null}
                {setup.verificationUrl ? (
                  <div className="flex flex-col items-center pt-1">
                    <IntegrationSetupQr value={setup.verificationUrl} label={t('Integrations.scanQr')} />
                    <a
                      className="mt-2 text-xs text-[var(--nimi-action-primary-bg)] underline"
                      href={setup.verificationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('Integrations.verifyLink')}
                    </a>
                  </div>
                ) : null}
                {setupActive && setup.adapter === 'weixin' && setup.status === 'awaiting-input' ? (
                  <>
                    <label className="mt-3 block">
                      {t('Integrations.verificationCode')}
                      <input
                        ref={verificationCode}
                        className={fieldClass}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        pattern="[0-9]+"
                        maxLength={32}
                        aria-invalid={error === t('Integrations.verificationInvalid')}
                        disabled={busy}
                      />
                    </label>
                    <Button className="mt-2" disabled={busy} onClick={submitVerification}>
                      {t('Integrations.submitVerification')}
                    </Button>
                  </>
                ) : null}
                {setupActive && setup.status === 'awaiting-new-target' ? (
                  <>
                    <p className="mt-3">{t('Integrations.newTargetConfirmation')}</p>
                    <Button
                      type="button"
                      className="mt-3"
                      tone="primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async (version) => {
                          const next = await sdk
                            .appProduct()
                            .integration.submitConnectionSetup({
                              setupId: setup.setupId,
                              secret: '',
                              verificationCode: '',
                              action: 'create-new-target',
                            });
                          applySetupReply(next, version, setup.setupId);
                        })
                      }
                    >
                      {t('Integrations.confirmNewTarget')}
                    </Button>
                  </>
                ) : null}
                {setup.errorCode ? (
                  <p>
                    {t(integrationErrorTranslationKey(setup.errorCode, setup.adapter), {
                      defaultValue: t('Integrations.unavailable'),
                    })}
                  </p>
                ) : null}
                {setupActive ? (
                  <Button
                    type="button"
                    className="mt-2"
                    tone="secondary"
                    disabled={busy}
                    onClick={closeConnection}
                  >
                    {t(cancelingSetup ? 'Integrations.cancelingSetup' : 'Integrations.cancelSetup')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {!setupActive ? (
              <Button
                type="submit"
                tone="primary"
                disabled={busy || (adapter !== 'weixin' && !name.trim())}
                leadingIcon={!busy && adapter === 'weixin' && !refreshRef ? <QrCode size={15} /> : undefined}
              >
                {t(
                  busy
                    ? 'Integrations.working'
                    : refreshRef
                      ? 'Integrations.refreshConnection'
                      : adapter === 'weixin'
                        ? 'Integrations.connectWeixin'
                        : 'Integrations.connect',
                )}
              </Button>
            ) : null}
            <p className="flex items-start gap-2 border-t border-[var(--nimi-border-subtle)] pt-4 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
              <ShieldCheck size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{t('Integrations.custody')}</span>
            </p>
          </form>
        </ScrollArea>
      </OverlayShell>
      <OverlayShell
        open={permissionOpen && Boolean(target)}
        kind="drawer"
        size="sm"
        closeOnBackdrop
        onClose={() => {
          if (!busy) setPermissionOpen(false);
        }}
        title={
          <div className="flex items-center justify-between gap-3">
            <span>{t(editingConsumerRef ? 'Integrations.editPermissions' : 'Integrations.authorizeApp')}</span>
            <Button
              tone="ghost"
              size="sm"
              aria-label={t('Integrations.close')}
              disabled={busy}
              onClick={() => setPermissionOpen(false)}
            >
              <X size={18} />
            </Button>
          </div>
        }
        panelClassName="flex flex-col"
        contentClassName="flex min-h-0 flex-1 flex-col !p-0"
        footer={
          editingConsumerRef || permissionConsumers.length ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
                {consumers.length
                  ? t('Integrations.selectionSummary', {
                      apps: consumers.length,
                      ops: operations.length,
                    })
                  : t('Integrations.noAppsSelected')}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button tone="secondary" disabled={busy} onClick={() => setPermissionOpen(false)}>
                  {t('Integrations.cancel')}
                </Button>
                <Button
                  tone="primary"
                  disabled={busy || !consumers.length || (!editingConsumerRef && !operations.length)}
                  onClick={requestSave}
                >
                  {t(editingConsumerRef ? 'Integrations.savePermissions' : 'Integrations.confirmAuthorization')}
                </Button>
              </div>
            </div>
          ) : undefined
        }
        data-testid="integration-permission-drawer"
      >
        <ScrollArea className="min-h-0 flex-1" contentClassName="px-6 py-2">
          {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
          {target && !editingConsumerRef && !permissionConsumers.length ? (
            <div className="px-4 py-12 text-center">
              <ShieldCheck size={28} aria-hidden="true" className="mx-auto mb-4 text-[var(--nimi-text-muted)]" />
              <h2 className="text-base font-semibold">{t('Integrations.noAppsToAuthorize')}</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                {t(snapshot?.consumers.length ? 'Integrations.allAppsAuthorized' : 'Integrations.noEligibleApps')}
              </p>
              {snapshot?.consumers.length ? (
                <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                  {t('Integrations.editExistingPermissionsHelp')}
                </p>
              ) : null}
            </div>
          ) : target ? (
            <>
              <p className="mb-4 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                {t(editingConsumerRef ? 'Integrations.editPermissionsHelp' : 'Integrations.authorizeAppsHelp', {
                  connection: target.displayName,
                })}
              </p>
              <fieldset className="mt-1 flex flex-col gap-2">
                <legend className="mb-1 text-sm font-semibold">{t('Integrations.apps')}</legend>
                {permissionConsumers.map((app) => {
                  const selected = consumers.includes(app.consumerRef);
                  return (
                    <div key={app.consumerRef} className={permissionCardClass(selected)}>
                      <label
                        className={`flex items-start gap-3 px-3 pt-3 ${
                          editingConsumerRef ? '' : busy ? 'cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      >
                        {!editingConsumerRef ? (
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={selected}
                            disabled={busy}
                            onChange={() => toggleConsumer(app.consumerRef)}
                          />
                        ) : null}
                        <AppArtworkIcon
                          appId={app.appId}
                          displayName={app.displayName || app.appId}
                          iconUrl={appIconUrls?.get(app.appId) ?? null}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {app.displayName || app.appId}
                            </span>
                            <StatusBadge tone={sourceTone(app)} shape="soft" className="shrink-0">
                              {describeSource(app)}
                            </StatusBadge>
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-[var(--nimi-text-secondary)]">
                            {allowedFor(app.consumerRef).length
                              ? t('Integrations.currentOperations', {
                                  operations: allowedFor(app.consumerRef)
                                    .map((name) => operationName(name))
                                    .join(', '),
                                })
                              : t('Integrations.noCurrentOperations')}
                          </span>
                        </span>
                        {!editingConsumerRef ? (
                          <span aria-hidden="true" className={`mt-0.5 ${permissionCheckClass}`}>
                            <Check size={13} strokeWidth={3} />
                          </span>
                        ) : null}
                      </label>
                      <div className="pb-2 pl-14 pr-3">
                        <IntegrationConsumerDetails consumerRef={app.consumerRef} />
                      </div>
                    </div>
                  );
                })}
              </fieldset>
              <fieldset data-testid="integration-operations" className="mt-5 flex flex-col gap-2">
                <legend className="mb-1 text-sm font-semibold">{t('Integrations.operations')}</legend>
                {target.operations.map((op) => {
                  const display = integrationOperationPresentation(target.kind, op, t);
                  const selected = operations.includes(op.name);
                  const OperationIcon = integrationOperationIcon(target.kind, op);
                  return (
                    <div key={op.name} className={permissionCardClass(selected)}>
                      <label
                        className={`flex items-start gap-3 px-3 pt-3 ${
                          busy ? 'cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={selected}
                          disabled={busy}
                          onChange={() => setOperations((current) => toggle(current, op.name))}
                        />
                        <span
                          aria-hidden="true"
                          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)] text-[var(--nimi-text-secondary)] transition-colors peer-checked:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] peer-checked:text-[var(--nimi-action-primary-bg)]"
                        >
                          <OperationIcon size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{display.name}</span>
                            <StatusBadge
                              tone={op.effect === 'write' ? 'warning' : 'neutral'}
                              shape="soft"
                              className="shrink-0"
                            >
                              {t(op.effect === 'write' ? 'Integrations.write' : 'Integrations.read')}
                            </StatusBadge>
                          </span>
                          <span className="mt-1 block text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
                            {display.summary}
                          </span>
                        </span>
                        <span aria-hidden="true" className={`mt-0.5 ${permissionCheckClass}`}>
                          <Check size={13} strokeWidth={3} />
                        </span>
                      </label>
                      <details className="mx-3 mb-2 ml-14 mt-1 rounded-lg px-2 py-1 text-xs text-[var(--nimi-text-muted)]">
                        <summary className="cursor-pointer">{t('Integrations.operationDetails')}</summary>
                        <p className="mt-2 break-all">{op.name}</p>
                        <p className="mt-2">
                          {t('Integrations.descriptorSource', { source: target.displayName })}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap leading-relaxed">{op.description}</p>
                      </details>
                    </div>
                  );
                })}
              </fieldset>
              {staleOperations.length ? (
                <div className="mt-5 rounded-xl border border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] p-3">
                  <p className="text-sm font-medium text-[var(--nimi-status-warning-soft-text)]">
                    {t('Integrations.unlistedOperations')}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">
                    {t('Integrations.unlistedOperationsHelp')}
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {staleOperations.map((name) => (
                      <label
                        key={name}
                        className={`flex items-center gap-2 rounded-lg px-1 py-1 ${
                          busy ? 'cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={operations.includes(name)}
                          disabled={busy}
                          onChange={() => setOperations((current) => toggle(current, name))}
                        />
                        <span aria-hidden="true" className={permissionCheckClass}>
                          <Check size={13} strokeWidth={3} />
                        </span>
                        <code className="break-all rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] px-1.5 py-0.5 text-[11px]">
                          {name}
                        </code>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </ScrollArea>
      </OverlayShell>
      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming?.kind === 'remove'
            ? t('Integrations.removeTitle', { name: confirming.name })
            : confirming?.kind === 'revoke'
              ? t('Integrations.revokeTitle', { app: confirming.app })
              : t('Integrations.narrowTitle')
        }
        message={
          confirming?.kind === 'remove' ? (
            <div className="space-y-3">
              <p>{t('Integrations.removeBody')}</p>
              <p className="font-medium">{t('Integrations.affectedApps')}</p>
              <ul className="list-disc pl-5">
                {snapshot?.permissions
                  .filter(
                    (permission) =>
                      permission.targetRef === confirming.targetRef && permission.operations.length,
                  )
                  .map((permission) => {
                    const app =
                      snapshot.consumers.find((item) => item.consumerRef === permission.consumerRef) ||
                      permission.consumer ||
                      undefined;
                    return (
                      <li key={permission.consumerRef}>
                        {app?.displayName || app?.appId || t('Integrations.unavailableApp')}
                        <span className="block text-xs text-[var(--nimi-text-secondary)]">
                          {describeSource(app)}
                        </span>
                        <IntegrationConsumerDetails consumerRef={permission.consumerRef} />
                      </li>
                    );
                  })}
              </ul>
            </div>
          ) : confirming?.kind === 'revoke' ? (
            <div>
              <p>
              {confirming.service
                ? t('Integrations.revokeBody', { service: confirming.service })
                : t('Integrations.revokeBodyGeneric')}
              </p>
              <IntegrationConsumerDetails consumerRef={confirming.permission.consumerRef} />
            </div>
          ) : confirming?.kind === 'narrow' ? (
            <div className="flex flex-col gap-2">
              <p>{confirming.intent.target.displayName}</p>
              <p>{t('Integrations.narrowBody')}</p>
              <ul className="list-disc pl-5">
                {confirming.changes.map((change) => (
                  <li key={change.app}>
                    {t('Integrations.narrowChange', {
                      app: change.app,
                      operations: change.removed
                        .map((name) => operationName(name, confirming.intent.target))
                        .join(', '),
                    })}
                    <details className="mt-1 text-xs">
                      <summary>{t('Integrations.operationDetails')}</summary>
                      <p className="mt-1 break-all">{change.removed.join(', ')}</p>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        }
        confirmLabel={
          confirming?.kind === 'remove'
            ? t('Integrations.removeConfirm')
            : confirming?.kind === 'revoke'
              ? t('Integrations.revokeConfirm')
              : t('Integrations.narrowConfirm')
        }
        cancelLabel={t('Integrations.cancel')}
        confirmTone="danger"
        loading={busy}
        onConfirm={() => {
          const current = confirming;
          setConfirming(null);
          if (current?.kind === 'remove') void removeConnection(current.targetRef);
          else if (current?.kind === 'revoke') void performRevoke(current.permission);
          else if (current?.kind === 'narrow') void savePermissions(current.intent);
        }}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
