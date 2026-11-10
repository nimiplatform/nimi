import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button, ConfirmDialog, FieldShell, InlineAlert, SelectField, Statistic, StatisticGroup, StatusBadge } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAgentReference } from '@nimiplatform/sdk/app';

import { useLabRendererHost } from '../../renderer/context.js';
import { requireLabNativeClient } from '../../shell/local-app-runtime-platform.js';
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
  const client = requireLabNativeClient(useLabRendererHost().sdk.localAppClient);
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
  const sessionRevisionRef = useRef(0);
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
    const wasBound = sessionBoundRef.current;
    sessionRevisionRef.current += 1;
    runtimeLossLatched.current = true;
    sessionBoundRef.current = false;
    setSessionBound(false);
    if (wasBound) setSessionLost(technical);
    agentReferencesRef.current = [];
    selectedAgentHandleRef.current = '';
    setAgentReferences([]);
    setSelectedAgentHandle('');
    updateProbeStates((current) => applySessionLoss(current));
    setFacts((current) => ({
      ...current,
      session: { state: 'unavailable', detail: t('AppAccess.factDetails.sessionLostRecheck'), technical },
      'current-user': { state: 'unavailable', detail: t('AppAccess.factDetails.currentUserUnavailable') },
    }));
  }, [t, updateProbeStates]);

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
    const revision = sessionRevisionRef.current;
    try {
      const user = await client.currentUser.get();
      if (revision !== sessionRevisionRef.current) return;
      setFacts((current) => ({
        ...current,
        'current-user': {
          state: 'ready',
          detail: t('AppAccess.factDetails.currentUserSummary', {
            name: user.displayName,
            handle: user.handle.replace(/^@+/, ''),
            avatar: t(user.avatarUrl ? 'AppAccess.factDetails.avatarSet' : 'AppAccess.factDetails.avatarNone'),
          }),
        },
      }));
    } catch (error) {
      if (revision !== sessionRevisionRef.current) return;
      setFacts((current) => ({
        ...current,
        'current-user': { state: 'unavailable', detail: t('AppAccess.factDetails.currentUserUnavailable'), technical: boundedError(error) },
      }));
    }
  }, [client, markSessionLost, t]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  // Keep the visible result scoped to the current App session without polling
  // the native bridge ten times a second while the diagnostic page is idle.
  useEffect(() => {
    let disposed = false;
    let checking = false;
    const checkRuntime = async () => {
      if (disposed || checking || runtimeLossLatched.current || document.visibilityState === 'hidden') return;
      checking = true;
      const revision = sessionRevisionRef.current;
      try {
        const status = await client.auth.status();
        if (!disposed && revision === sessionRevisionRef.current && !status.sessionBound) markSessionLost(`${status.state} · ${status.reasonCode}`);
      } catch (error) {
        if (!disposed && revision === sessionRevisionRef.current) markSessionLost(boundedError(error));
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void checkRuntime(), 1_200);
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
    const revision = sessionRevisionRef.current;
    updateProbeStates((current) => applyProbeStart(current, id));
    if (id === 'agent-references') {
      const run = await runAgentReferencesProbe(client);
      if (revision !== sessionRevisionRef.current) return false;
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
    if (revision !== sessionRevisionRef.current) return false;
    updateProbeStates((current) => applyProbeOutcome(current, id, outcome));
    return outcome.ok;
  }, [client, gateContext, updateProbeStates]);

  const requestProbeRun = useCallback((id: AppAccessProbeId) => {
    if (runningGroup || Object.values(probeStatesRef.current).some(state => state.status === 'running')) return;
    if (appAccessProbeById[id].requiresExplicitConfirmation) {
      setExplicitProbe(id);
      return;
    }
    void runProbe(id);
  }, [runProbe, runningGroup]);

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
    if (runningGroup || Object.values(probeStatesRef.current).some(state => state.status === 'running')) return;
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
    if (runningGroup || Object.values(probeStatesRef.current).some(state => state.status === 'running')) return;
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
  const currentGroup = appAccessGroups.find((group) => group.id === section);
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
              disabled={agentReferences.length === 0 || runningGroup !== null || probeSummary.running > 0}
              placeholder={t(probeStates[id].status === 'passed' ? 'AppAccess.page.agentSelectPlaceholder' : 'AppAccess.page.agentSelectBeforeRun')}
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
    <section ref={panelRef} className="lab-workspace-route app-access" data-testid={appAccessPageIds.page} aria-labelledby="app-access-title">
      <div className="app-access__canvas">
        <header className="lab-workspace-heading">
          <span className="lab-workspace-heading__icon" aria-hidden="true"><ShieldCheck size={22} /></span>
          <div>
            <h1 id="app-access-title" tabIndex={-1} data-app-access-section-title={currentGroup ? undefined : ''}>{t(appAccessPageCopy.title)}</h1>
            <p>{t(appAccessPageCopy.blurb)}</p>
          </div>
        </header>
        {sessionLost ? <InlineAlert tone="warning">{t(appAccessPageCopy.sessionLost)}</InlineAlert> : null}

        {!currentGroup ? (
          <>
            <AppAccessSessionBar facts={facts} onRefresh={() => void refreshSession()} />
            <div className="app-access__checks-head">
              <div>
                <h2 className="app-access-group__title">{t('AppAccess.page.checksTitle')}</h2>
                <p id="app-access-run-all-impact" className="app-access__blurb">{t('AppAccess.page.runAllImpact')}</p>
              </div>
              <Button
                type="button"
                tone="primary"
                size="sm"
                leadingIcon={<Play size={14} aria-hidden="true" />}
                data-testid={appAccessPageIds.runAll}
                aria-describedby="app-access-run-all-impact"
                disabled={!sessionBound || runningGroup !== null || probeSummary.running > 0}
                loading={runningGroup === 'all'}
                onClick={() => void runAll()}
              >
                {t(appAccessPageCopy.runAll)}
              </Button>
            </div>

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

            <div className="app-access-index">
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
                      <span>{t(group.blurbKey)}</span>
                      <span className="app-access-index__count">
                        {progress.touched > 0
                          ? t('AppAccess.page.groupProgress', { passed: progress.passed, total: progress.total })
                          : t('AppAccess.index.probeCount', { count: progress.total, plural: progress.total === 1 ? '' : 's' })}
                      </span>
                    </span>
                    <ChevronRight size={16} strokeWidth={2} aria-hidden="true" className="app-access-index__chevron" />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="app-access__detail-tools">
              <Button type="button" tone="ghost" size="sm" leadingIcon={<ArrowLeft size={15} aria-hidden="true" />} onClick={() => selectSection('overview')}>
                {t('AppAccess.nav.overview')}
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={sessionBound ? 'success' : facts.session.state === 'checking' ? 'info' : 'warning'} shape="soft">
                  {facts.session.detail}
                </StatusBadge>
                {!sessionBound && <Button type="button" tone="ghost" size="sm" leadingIcon={<RefreshCw size={14} aria-hidden="true" />} onClick={() => void refreshSession()}>
                  {t(appAccessPageCopy.refreshSession)}
                </Button>}
              </div>
            </div>
            <AppAccessGroup
              key={currentGroup.id}
              definition={currentGroup}
              states={probeStates}
              gateFor={gateFor}
              activeRun={runningGroup === currentGroup.id || (runningGroup === 'all' && currentGroup.probes.some(id => probeStates[id].status === 'running'))}
              anyRunActive={runningGroup !== null || probeSummary.running > 0}
              sessionBound={sessionBound}
              onRunProbe={requestProbeRun}
              onRunGroup={() => void runGroup(currentGroup.id)}
              renderExtras={renderExtras}
            />
          </>
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
