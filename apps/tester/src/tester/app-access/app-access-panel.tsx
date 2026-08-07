import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, FieldShell, InlineAlert, SelectField, StatusBadge, TextField } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAgentReference } from '@nimiplatform/sdk/app';

import { getTesterLocalAppClient } from '../../shell/local-app-runtime-platform.js';
import {
  appAccessCloudFields,
  appAccessGroups,
  appAccessPageCopy,
  appAccessPageIds,
  emptyAppAccessCloudDraft,
  type AppAccessCloudDraft,
  type AppAccessCloudFieldId,
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
import { AppAccessGroup } from './app-access-group.js';
import { AppAccessSessionBar, type AppAccessSessionFacts } from './app-access-session-bar.js';

type TesterHotContext = {
  readonly on: (event: 'vite:beforeUpdate', callback: () => void) => void;
  readonly off: (event: 'vite:beforeUpdate', callback: () => void) => void;
};

const testerHot = (import.meta as ImportMeta & { readonly hot?: TesterHotContext }).hot;

const sessionStateCopy: Readonly<Record<string, string>> = {
  'session-bound': 'Session bound',
  'action-required': 'Action required — check Nimi Desktop',
  revoked: 'Session revoked — sign in again',
  'project-changed': 'Project changed — re-open the App',
  'process-replaced': 'App process was replaced — restart the App',
  'account-changed': 'Account changed — sign in again',
  'runtime-restarted': 'Runtime restarted — refresh the session',
  unavailable: 'Session unavailable',
};

function sessionStateLabel(state: string): string {
  return sessionStateCopy[state] ?? 'Session unavailable';
}

function boundedError(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reason = typeof record.reasonCode === 'string' ? record.reasonCode : 'operation-failed';
  return reason.slice(0, 160);
}

export function AppAccessPanel() {
  const [facts, setFacts] = useState<AppAccessSessionFacts>(() => ({
    'app-process': { state: 'ready', detail: `Renderer since ${new Date(performance.timeOrigin).toISOString()}` },
    session: { state: 'checking', detail: 'Checking the Nimi session…' },
    tooling: {
      state: testerHot ? 'ready' : 'unavailable',
      detail: testerHot ? 'Vite HMR client active' : 'No official HMR client observed',
    },
    'current-user': { state: 'checking', detail: 'Checking the current user…' },
  }));
  const [sessionBound, setSessionBound] = useState(false);
  const [sessionLost, setSessionLost] = useState<string | null>(null);
  const [probeStates, setProbeStates] = useState<AppAccessProbeStates>(createInitialProbeStates);
  const [agentReferences, setAgentReferences] = useState<readonly NimiLocalAppAgentReference[]>([]);
  const [selectedAgentHandle, setSelectedAgentHandle] = useState('');
  const [cloudDraft, setCloudDraft] = useState<AppAccessCloudDraft>(emptyAppAccessCloudDraft);
  const [runningGroup, setRunningGroup] = useState<AppAccessGroupId | 'all' | null>(null);

  // Refs mirror the latest committed values so sequential group/run-all loops
  // read fresh state synchronously instead of waiting for re-renders.
  const runtimeLossLatched = useRef(false);
  const probeStatesRef = useRef(probeStates);
  const sessionBoundRef = useRef(sessionBound);
  const cloudDraftRef = useRef(cloudDraft);
  const agentReferencesRef = useRef(agentReferences);
  const selectedAgentHandleRef = useRef(selectedAgentHandle);

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
      session: { state: 'unavailable', detail: 'Session lost — refresh to re-check', technical },
    }));
  }, [updateProbeStates]);

  // Session and current-user facts are queried independently; neither is
  // derived from the other.
  const refreshSession = useCallback(async () => {
    const client = getTesterLocalAppClient();
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
          detail: sessionStateLabel(status.state),
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
          detail: `${user.displayName} · @${user.handle} · avatar ${user.avatarUrl ? 'set' : 'none'}`,
        },
      }));
    } catch (error) {
      setFacts((current) => ({
        ...current,
        'current-user': { state: 'unavailable', detail: 'Current user unavailable', technical: boundedError(error) },
      }));
    }
  }, [markSessionLost]);

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
        const status = await getTesterLocalAppClient().auth.status();
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
  }, [markSessionLost]);

  useEffect(() => {
    if (!testerHot) return undefined;
    const onUpdate = () => setFacts((current) => ({
      ...current,
      tooling: { state: 'ready', detail: `HMR update observed · ${new Date().toISOString()}` },
    }));
    testerHot.on('vite:beforeUpdate', onUpdate);
    return () => testerHot.off('vite:beforeUpdate', onUpdate);
  }, []);

  const gateContext = useCallback((): AppAccessGateContext => ({
    sessionBound: sessionBoundRef.current,
    cloudDraftComplete: appAccessCloudFields.every((field) => cloudDraftRef.current[field.id].trim().length > 0),
    agentReferenceSelected: agentReferencesRef.current.some(
      (reference) => reference.agentHandle === selectedAgentHandleRef.current,
    ),
  }), []);

  const runProbe = useCallback(async (id: AppAccessProbeId): Promise<boolean> => {
    const gate = resolveProbeGate(id, probeStatesRef.current, gateContext());
    if (!gate.runnable || probeStatesRef.current[id].status === 'running') return false;
    updateProbeStates((current) => applyProbeStart(current, id));
    const client = getTesterLocalAppClient();
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
      cloudDraft: cloudDraftRef.current,
      agentReference: reference,
    });
    updateProbeStates((current) => applyProbeOutcome(current, id, outcome));
    return outcome.ok;
  }, [gateContext, updateProbeStates]);

  // Group runs walk the group's probes in dependency order and stop on the
  // first failure; run-all continues with the next group after a failure.
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
        for (const id of group.probes) {
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

  const updateCloudDraft = (field: AppAccessCloudFieldId, value: string) => {
    const next = { ...cloudDraftRef.current, [field]: value };
    cloudDraftRef.current = next;
    setCloudDraft(next);
  };

  const selectAgent = (value: string) => {
    selectedAgentHandleRef.current = value;
    setSelectedAgentHandle(value);
  };

  const currentGateContext: AppAccessGateContext = {
    sessionBound,
    cloudDraftComplete: appAccessCloudFields.every((field) => cloudDraft[field.id].trim().length > 0),
    agentReferenceSelected: agentReferences.some((reference) => reference.agentHandle === selectedAgentHandle),
  };
  const gateFor = (id: AppAccessProbeId) => resolveProbeGate(id, probeStates, currentGateContext);

  const renderExtras = (id: AppAccessProbeId) => {
    if (id === 'cloud-posture') {
      return (
        <div className="app-access-cloud-form">
          {appAccessCloudFields.map((field) => (
            <FieldShell key={field.id} label={field.label} className="app-access-cloud-form__field">
              <TextField
                value={cloudDraft[field.id]}
                data-testid={field.testId}
                onChange={(event) => updateCloudDraft(field.id, event.currentTarget.value)}
              />
            </FieldShell>
          ))}
        </div>
      );
    }
    if (id === 'agent-references') {
      return (
        <div className="app-access-agent-picker">
          <SelectField
            aria-label="Current active Agent"
            data-testid={appAccessPageIds.agentSelect}
            value={selectedAgentHandle}
            placeholder="No active Agent"
            options={agentReferences.map((reference) => ({
              value: reference.agentHandle,
              label: reference.displayName,
            }))}
            onValueChange={selectAgent}
          />
        </div>
      );
    }
    return undefined;
  };

  return (
    <section className="app-access" data-testid={appAccessPageIds.page} aria-labelledby="app-access-title">
      <header className="app-access__head">
        <div className="app-access__head-text">
          <p className="app-access__eyebrow">{appAccessPageCopy.eyebrow}</p>
          <h1 id="app-access-title" className="app-access__title">{appAccessPageCopy.title}</h1>
          <p className="app-access__blurb">{appAccessPageCopy.blurb}</p>
        </div>
        <div className="app-access__head-actions">
          <StatusBadge tone={sessionBound ? 'success' : 'neutral'} shape="dot">
            {sessionBound ? 'Session bound' : 'No session'}
          </StatusBadge>
          <Button
            type="button"
            tone="ghost"
            size="sm"
            leadingIcon={<RefreshCw size={14} aria-hidden="true" />}
            data-testid={appAccessPageIds.refreshSession}
            onClick={() => void refreshSession()}
          >
            {appAccessPageCopy.refreshSession}
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
            {appAccessPageCopy.runAll}
          </Button>
        </div>
      </header>

      {sessionLost ? (
        <InlineAlert tone="info" className="app-access__banner">{appAccessPageCopy.sessionLost}</InlineAlert>
      ) : null}
      {!sessionBound ? (
        <InlineAlert tone="info" className="app-access__banner">{appAccessPageCopy.signedOut}</InlineAlert>
      ) : null}

      <AppAccessSessionBar facts={facts} />

      {appAccessGroups.map((group) => (
        <AppAccessGroup
          key={group.id}
          definition={group}
          states={probeStates}
          gateFor={gateFor}
          groupRunning={runningGroup !== null}
          onRunProbe={(id) => void runProbe(id)}
          onRunGroup={() => void runGroup(group.id)}
          renderExtras={renderExtras}
        />
      ))}
    </section>
  );
}
