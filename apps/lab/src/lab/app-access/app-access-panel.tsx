import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, LayoutDashboard, RefreshCw } from 'lucide-react';
import { Button, ConfirmDialog, FieldShell, InlineAlert, SelectField, Statistic, StatisticGroup, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAgentReference } from '@nimiplatform/sdk/app';

import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import {
  appAccessGroups,
  appAccessPageCopy,
  appAccessPageIds,
  appAccessProbeById,
  type AppAccessGroupId,
  type AppAccessProbeId,
} from './app-access-catalog.js';
import {
  runAgentReferencesProbe,
  runAppAccessProbe,
} from './app-access-probes.js';
import {
  applyProbeOutcome,
  applyProbeStart,
  applySessionLoss,
  createInitialProbeStates,
  planGroupRun,
  resolveProbeGate,
  type AppAccessGateContext,
  type AppAccessProbeStates,
} from './app-access-state.js';
import { AppAccessGroup, appAccessGroupIcon } from './app-access-group.js';
import { AppAccessSessionBar, type AppAccessSessionFacts } from './app-access-session-bar.js';

type LabHotContext = {
  readonly on: (event: 'vite:beforeUpdate', callback: () => void) => void;
  readonly off: (event: 'vite:beforeUpdate', callback: () => void) => void;
};

const labHot = (import.meta as ImportMeta & { readonly hot?: LabHotContext }).hot;

const sessionStateKeys: Readonly<Record<string, string>> = {
  'session-bound': 'AppAccess.sessionStates.sessionBound',
  'action-required': 'AppAccess.sessionStates.actionRequired',
  revoked: 'AppAccess.sessionStates.revoked',
  'project-changed': 'AppAccess.sessionStates.projectChanged',
  'process-replaced': 'AppAccess.sessionStates.processReplaced',
  'account-changed': 'AppAccess.sessionStates.accountChanged',
  'runtime-restarted': 'AppAccess.sessionStates.runtimeRestarted',
  unavailable: 'AppAccess.sessionStates.unavailable',
};

function sessionStateKey(state: string): string {
  return sessionStateKeys[state] ?? 'AppAccess.sessionStates.unavailable';
}

function boundedError(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reason = typeof record.reasonCode === 'string' ? record.reasonCode : 'operation-failed';
  return reason.slice(0, 160);
}

export function AppAccessPanel() {
  const { t } = useTranslation();
  const client = useLabRendererHost().sdk.localAppClient;
  const [facts, setFacts] = useState<AppAccessSessionFacts>(() => ({
    'app-process': { state: 'ready', detail: t('AppAccess.factDetails.rendererSince', { time: new Date(performance.timeOrigin).toISOString() }) },
    session: { state: 'checking', detail: t('AppAccess.factDetails.checkingSession') },
    tooling: {
      state: labHot ? 'ready' : 'unavailable',
      detail: t(labHot ? 'AppAccess.factDetails.toolingHmrActive' : 'AppAccess.factDetails.toolingHmrMissing'),
    },
    'current-user': { state: 'checking', detail: t('AppAccess.factDetails.checkingCurrentUser') },
  }));
  const [sessionBound, setSessionBound] = useState(false);
  const [sessionLost, setSessionLost] = useState<string | null>(null);
  const [probeStates, setProbeStates] = useState<AppAccessProbeStates>(createInitialProbeStates);
  const [agentReferences, setAgentReferences] = useState<readonly NimiLocalAppAgentReference[]>([]);
  const [selectedAgentHandle, setSelectedAgentHandle] = useState('');
  const [runningGroup, setRunningGroup] = useState<AppAccessGroupId | 'all' | null>(null);
  const [explicitProbe, setExplicitProbe] = useState<AppAccessProbeId | null>(null);
  const [explicitProbeRunning, setExplicitProbeRunning] = useState(false);
  const [section, setSection] = useState<AppAccessGroupId | 'overview'>('overview');
  const panelRef = useRef<HTMLElement>(null);
  const sectionNavigationPendingRef = useRef(false);

  // Refs mirror the latest committed values so sequential group/run-all loops
  // read fresh state synchronously instead of waiting for re-renders.
  const runtimeLossLatched = useRef(false);
  const probeStatesRef = useRef(probeStates);
  const sessionBoundRef = useRef(sessionBound);
  const agentReferencesRef = useRef(agentReferences);
  const selectedAgentHandleRef = useRef(selectedAgentHandle);

  const selectSection = useCallback((nextSection: AppAccessGroupId | 'overview') => {
    if (nextSection === section) return;
    sectionNavigationPendingRef.current = true;
    setSection(nextSection);
  }, [section]);

  useLayoutEffect(() => {
    if (!sectionNavigationPendingRef.current) return;
    sectionNavigationPendingRef.current = false;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('[data-app-access-section-title]')?.focus({ preventScroll: true });
    if (panel) panel.scrollTop = 0;
  }, [section]);

  const updateProbeStates = useCallback((update: (current: AppAccessProbeStates) => AppAccessProbeStates) => {
    const next = update(probeStatesRef.current);
    probeStatesRef.current = next;
    setProbeStates(next);
  }, []);

  const markSessionLost = useCallback((technical: string) => {
    runtimeLossLatched.current = true;
    sessionBoundRef.current = false;
    setSessionBound(false);
    setSessionLost(technical);
    updateProbeStates((current) => applySessionLoss(current));
    setFacts((current) => ({
      ...current,
      session: { state: 'unavailable', detail: t('AppAccess.factDetails.sessionLostRecheck'), technical },
    }));
  }, [updateProbeStates]);

  // Session and current-user facts are queried independently; neither is
  // derived from the other.
  const refreshSession = useCallback(async () => {
    try {
      const status = await client.auth.status();
      if (!status.sessionBound) {
        markSessionLost(`${status.state} · ${status.reasonCode}`);
      } else {
        runtimeLossLatched.current = false;
        sessionBoundRef.current = true;
        setSessionBound(true);
        setSessionLost(null);
      }
      setFacts((current) => ({
        ...current,
        session: {
          state: status.sessionBound ? 'ready' : 'unavailable',
          detail: t(sessionStateKey(status.state)),
          technical: `${status.state} · ${status.reasonCode}`,
        },
      }));
    } catch (error) {
      markSessionLost(boundedError(error));
    }
    try {
      const user = await client.currentUser.get();
      setFacts((current) => ({
        ...current,
        'current-user': {
          state: 'ready',
          detail: t('AppAccess.factDetails.currentUserSummary', {
            name: user.displayName,
            handle: user.handle,
            avatar: t(user.avatarUrl ? 'AppAccess.factDetails.avatarSet' : 'AppAccess.factDetails.avatarNone'),
          }),
        },
      }));
    } catch (error) {
      setFacts((current) => ({
        ...current,
        'current-user': { state: 'unavailable', detail: t('AppAccess.factDetails.currentUserUnavailable'), technical: boundedError(error) },
      }));
    }
  }, [client, markSessionLost, t]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  // Runtime-loss watchdog, same semantics as the original panel: a short
  // interval re-checks the session until a loss is latched; after that only a
  // manual refresh re-arms it.
  useEffect(() => {
    let disposed = false;
    let checking = false;
    const checkRuntime = async () => {
      if (disposed || checking || runtimeLossLatched.current) return;
      checking = true;
      try {
        const status = await client.auth.status();
        if (!status.sessionBound) markSessionLost(`${status.state} · ${status.reasonCode}`);
      } catch (error) {
        markSessionLost(boundedError(error));
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void checkRuntime(), 100);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [client, markSessionLost]);

  useEffect(() => {
    if (!labHot) return undefined;
    const onUpdate = () => setFacts((current) => ({
      ...current,
      tooling: { state: 'ready', detail: t('AppAccess.factDetails.hmrUpdateObserved', { time: new Date().toISOString() }) },
    }));
    labHot.on('vite:beforeUpdate', onUpdate);
    return () => labHot.off('vite:beforeUpdate', onUpdate);
  }, []);

  const gateContext = useCallback((): AppAccessGateContext => ({
    sessionBound: sessionBoundRef.current,
    agentReferenceSelected: agentReferencesRef.current.some(
      (reference) => reference.agentHandle === selectedAgentHandleRef.current,
    ),
  }), []);

  const runProbe = useCallback(async (id: AppAccessProbeId): Promise<boolean> => {
    const gate = resolveProbeGate(id, probeStatesRef.current, gateContext());
    if (!gate.runnable || probeStatesRef.current[id].status === 'running') return false;
    updateProbeStates((current) => applyProbeStart(current, id));
    if (id === 'agent-references') {
      const run = await runAgentReferencesProbe(client);
      agentReferencesRef.current = run.references;
      setAgentReferences(run.references);
      const currentHandle = selectedAgentHandleRef.current;
      const nextHandle = run.references.some((reference) => reference.agentHandle === currentHandle)
        ? currentHandle
        : run.references[0]?.agentHandle ?? '';
      selectedAgentHandleRef.current = nextHandle;
      setSelectedAgentHandle(nextHandle);
      updateProbeStates((current) => applyProbeOutcome(current, id, run.outcome));
      return run.outcome.ok;
    }
    const reference = agentReferencesRef.current.find(
      (candidate) => candidate.agentHandle === selectedAgentHandleRef.current,
    ) ?? null;
    const outcome = await runAppAccessProbe(id, {
      client,
      agentReference: reference,
    });
    updateProbeStates((current) => applyProbeOutcome(current, id, outcome));
    return outcome.ok;
  }, [client, gateContext, updateProbeStates]);

  const requestProbeRun = useCallback((id: AppAccessProbeId) => {
    if (appAccessProbeById[id].requiresExplicitConfirmation) {
      setExplicitProbe(id);
      return;
    }
    void runProbe(id);
  }, [runProbe]);

  const confirmExplicitProbe = useCallback(async () => {
    if (!explicitProbe || explicitProbeRunning) return;
    setExplicitProbeRunning(true);
    try {
      await runProbe(explicitProbe);
      setExplicitProbe(null);
    } finally {
      setExplicitProbeRunning(false);
    }
  }, [explicitProbe, explicitProbeRunning, runProbe]);

  // Automatic plans walk probes in dependency order but deliberately omit
  // operations that require a per-run confirmation.
  const runGroup = useCallback(async (groupId: AppAccessGroupId) => {
    if (runningGroup) return;
    setRunningGroup(groupId);
    try {
      for (const id of planGroupRun(groupId)) {
        const gate = resolveProbeGate(id, probeStatesRef.current, gateContext());
        if (!gate.runnable) continue;
        const ok = await runProbe(id);
        if (!ok) break;
      }
    } finally {
      setRunningGroup(null);
    }
  }, [gateContext, runProbe, runningGroup]);

  const runAll = useCallback(async () => {
    if (runningGroup) return;
    setRunningGroup('all');
    try {
      await refreshSession();
      for (const group of appAccessGroups) {
        for (const id of planGroupRun(group.id)) {
          const gate = resolveProbeGate(id, probeStatesRef.current, gateContext());
          if (!gate.runnable) continue;
          const ok = await runProbe(id);
          if (!ok) break;
        }
      }
    } finally {
      setRunningGroup(null);
    }
  }, [gateContext, refreshSession, runProbe, runningGroup]);

  const selectAgent = (value: string) => {
    selectedAgentHandleRef.current = value;
    setSelectedAgentHandle(value);
  };

  const currentGateContext: AppAccessGateContext = {
    sessionBound,
    agentReferenceSelected: agentReferences.some((reference) => reference.agentHandle === selectedAgentHandle),
  };
  const gateFor = (id: AppAccessProbeId) => resolveProbeGate(id, probeStates, currentGateContext);
  const explicitConfirmationCopy = explicitProbe === 'world-create'
    ? 'AppAccess.confirmPersistentWorld'
    : 'AppAccess.confirmPersistentPersona';

  const probeSummary = (() => {
    let passed = 0;
    let failed = 0;
    let running = 0;
    for (const id of Object.keys(probeStates) as AppAccessProbeId[]) {
      const status = probeStates[id].status;
      if (status === 'passed') passed += 1;
      else if (status === 'failed') failed += 1;
      else if (status === 'running') running += 1;
    }
    return { passed, failed, running, touched: passed + failed + running };
  })();

  const renderExtras = (id: AppAccessProbeId) => {
    if (id === 'agent-references') {
      return (
        <div className="app-access-agent-picker">
          <FieldShell label={t('AppAccess.page.agentSelectAriaLabel')}>
            <SelectField
              aria-label={t('AppAccess.page.agentSelectAriaLabel')}
              data-testid={appAccessPageIds.agentSelect}
              value={selectedAgentHandle}
              placeholder={t('AppAccess.page.agentSelectPlaceholder')}
              options={agentReferences.map((reference) => ({
                value: reference.agentHandle,
                label: reference.displayName,
              }))}
              onValueChange={selectAgent}
            />
          </FieldShell>
        </div>
      );
    }
    return undefined;
  };

  const groupProgress = (group: (typeof appAccessGroups)[number]) => {
    const passed = group.probes.filter((id) => probeStates[id].status === 'passed').length;
    const touched = group.probes.filter((id) => probeStates[id].status !== 'not-run').length;
    return { passed, touched, total: group.probes.length };
  };

  return (
    <section ref={panelRef} className="app-access" data-testid={appAccessPageIds.page} aria-labelledby="app-access-title">
      <Surface as="aside" material="glass-regular" tone="panel" elevation="raised" padding="none" className="app-access__sidebar">
        <div className="app-access__brand">
          <p className="app-access__eyebrow">{t(appAccessPageCopy.eyebrow)}</p>
          <h1 id="app-access-title" className="app-access__title">{t(appAccessPageCopy.title)}</h1>
          <div>
            <StatusBadge tone={sessionBound ? 'success' : 'neutral'} shape="soft">
              {sessionBound ? t('AppAccess.page.sessionBound') : t('AppAccess.page.noSession')}
            </StatusBadge>
          </div>
        </div>
        <nav className="app-access__nav" aria-label={t('AppAccess.nav.ariaLabel')}>
          <p className="app-access__nav-label">{t('AppAccess.nav.label')}</p>
          <button
            type="button"
            className="app-access__nav-item"
            data-active={section === 'overview' ? '' : undefined}
            aria-current={section === 'overview' ? 'page' : undefined}
            onClick={() => selectSection('overview')}
          >
            <span className="app-access__nav-symbol" aria-hidden="true"><LayoutDashboard size={17} strokeWidth={1.8} /></span>
            <span className="app-access__nav-copy"><strong>{t('AppAccess.nav.overview')}</strong></span>
          </button>
          {appAccessGroups.map((group) => {
            const Icon = appAccessGroupIcon(group.id);
            const progress = groupProgress(group);
            return (
              <button
                key={group.id}
                type="button"
                className="app-access__nav-item"
                data-active={section === group.id ? '' : undefined}
                aria-current={section === group.id ? 'page' : undefined}
                onClick={() => selectSection(group.id)}
              >
                <span className="app-access__nav-symbol" aria-hidden="true"><Icon size={17} strokeWidth={1.8} /></span>
                <span className="app-access__nav-copy"><strong>{t(group.titleKey)}</strong></span>
                <span className="app-access__nav-count">
                  {progress.touched > 0 ? `${progress.passed}/${progress.total}` : progress.total}
                </span>
              </button>
            );
          })}
        </nav>
      </Surface>

      <div className="app-access__canvas">
        {sessionLost ? (
          <InlineAlert tone="info" className="app-access__banner">{t(appAccessPageCopy.sessionLost)}</InlineAlert>
        ) : null}
        {!sessionBound ? (
          <InlineAlert tone="info" className="app-access__banner">{t(appAccessPageCopy.signedOut)}</InlineAlert>
        ) : null}

        {section === 'overview' ? (
          <>
            <header className="app-access__canvas-head">
              <div className="app-access__canvas-head-text">
                <h2 className="app-access__canvas-title" tabIndex={-1} data-app-access-section-title>{t('AppAccess.nav.overview')}</h2>
                <p className="app-access__blurb">{t(appAccessPageCopy.blurb)}</p>
              </div>
              <div className="app-access__head-actions">
                <Button
                  type="button"
                  tone="ghost"
                  size="sm"
                  leadingIcon={<RefreshCw size={14} aria-hidden="true" />}
                  data-testid={appAccessPageIds.refreshSession}
                  onClick={() => void refreshSession()}
                >
                  {t(appAccessPageCopy.refreshSession)}
                </Button>
                <Button
                  type="button"
                  tone="primary"
                  size="sm"
                  data-testid={appAccessPageIds.runAll}
                  disabled={!sessionBound || runningGroup !== null}
                  loading={runningGroup === 'all'}
                  onClick={() => void runAll()}
                >
                  {t(appAccessPageCopy.runAll)}
                </Button>
              </div>
            </header>

            {probeSummary.touched > 0 ? (
              <section className="app-access-summary" aria-label={t('AppAccess.page.summaryAriaLabel')}>
                <StatisticGroup>
                  {probeSummary.passed > 0 ? (
                    <Statistic label={t('AppAccess.status.passed')} value={probeSummary.passed} tone="success" />
                  ) : null}
                  {probeSummary.failed > 0 ? (
                    <Statistic label={t('AppAccess.status.failed')} value={probeSummary.failed} tone="danger" />
                  ) : null}
                  {probeSummary.running > 0 ? (
                    <Statistic label={t('AppAccess.status.running')} value={probeSummary.running} tone="info" />
                  ) : null}
                </StatisticGroup>
              </section>
            ) : null}

            <AppAccessSessionBar facts={facts} />

            <Surface as="div" tone="panel" material="glass-regular" elevation="base" padding="none" className="app-access-index">
              {appAccessGroups.map((group) => {
                const Icon = appAccessGroupIcon(group.id);
                const progress = groupProgress(group);
                return (
                  <button
                    key={group.id}
                    type="button"
                    className="app-access-index__row"
                    onClick={() => selectSection(group.id)}
                  >
                    <span className="app-access-group__icon" aria-hidden="true"><Icon size={17} strokeWidth={1.9} /></span>
                    <span className="app-access-index__copy">
                      <strong>{t(group.titleKey)}</strong>
                      <span>{t('AppAccess.index.probeCount', { count: progress.total, plural: progress.total === 1 ? '' : 's' })}</span>
                    </span>
                    {progress.touched > 0 ? (
                      <StatusBadge tone={progress.passed === progress.total ? 'success' : 'neutral'} shape="soft">
                        {t('AppAccess.page.groupProgress', { passed: progress.passed, total: progress.total })}
                      </StatusBadge>
                    ) : null}
                    <ChevronRight size={16} strokeWidth={2} aria-hidden="true" className="app-access-index__chevron" />
                  </button>
                );
              })}
            </Surface>
          </>
        ) : (
          appAccessGroups.filter((group) => group.id === section).map((group) => (
            <AppAccessGroup
              key={group.id}
              definition={group}
              states={probeStates}
              gateFor={gateFor}
              activeRun={runningGroup === group.id || runningGroup === 'all'}
              anyRunActive={runningGroup !== null}
              onRunProbe={requestProbeRun}
              onRunGroup={() => void runGroup(group.id)}
              renderExtras={renderExtras}
            />
          ))
        )}
      </div>

      <ConfirmDialog
        open={explicitProbe !== null}
        title={t(`${explicitConfirmationCopy}.title`)}
        message={t(`${explicitConfirmationCopy}.message`)}
        confirmLabel={t(`${explicitConfirmationCopy}.confirm`)}
        cancelLabel={t(`${explicitConfirmationCopy}.cancel`)}
        confirmTone="danger"
        loading={explicitProbeRunning}
        pendingLabel={t(`${explicitConfirmationCopy}.running`)}
        onConfirm={() => void confirmExplicitProbe()}
        onClose={() => {
          if (!explicitProbeRunning) setExplicitProbe(null);
        }}
      />
    </section>
  );
}
