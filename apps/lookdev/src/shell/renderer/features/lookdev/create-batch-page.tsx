import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import { Button, SelectField, TextField, type SelectFieldOption } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { getLookdevAgentAuthoringContext, listLookdevAgents, listLookdevWorldAgents, listLookdevWorlds } from '@renderer/data/lookdev-data-client.js';
import type { LookdevAgentRecord } from '@renderer/data/lookdev-data-client.js';
import { useAppStore, type RuntimeTargetOption } from '@renderer/app-shell/providers/app-store.js';
import { useLookdevRouteSettings } from '@renderer/hooks/use-lookdev-route-settings.js';
import { useLookdevStore } from './lookdev-store.js';
import {
  type LookdevCaptureState,
  normalizeLookdevLanguage,
  type LookdevSelectionSource,
  type LookdevWorldStylePack,
  type LookdevWorldStyleSession,
} from './types.js';
import {
  createCaptureStateKey,
  materializePortraitBriefFromCaptureState,
} from './capture-harness.js';
import {
  canSynthesizeWorldStyleSession,
  createWorldStyleSession,
  describeWorldStyleTarget,
} from './world-style-session.js';
import {
  handleStyleSessionReply as doStyleSessionReply,
  handleRestartStyleSession as doRestartStyleSession,
  handleSynthesizeStylePack as doSynthesizeStylePack,
  handleConfirmWorldStylePack as doConfirmWorldStylePack,
  handleInteractiveCaptureRefine as doInteractiveCaptureRefine,
  handleResetInteractiveCapture as doResetInteractiveCapture,
  handleCreate as doCreate,
} from './create-batch-page-handlers.js';
import { WorldStyleSessionPanel } from './world-style-session-panel.js';
import { CaptureSelectionPanel } from './capture-selection-panel.js';
import { EmbeddedCapturePanel } from './embedded-capture-panel.js';
import { CreateBatchPolicyPanel } from './create-batch-policy-panel.js';
import {
  formatTargetOptionLabel,
  formatWorldOptionLabel,
  isCurrentWorldStylePack,
  stripTargetKey,
  type LookdevSelectedAgent,
} from './create-batch-page-helpers.js';
import { useLookdevCaptureStateSynthesis } from './use-lookdev-capture-state-synthesis.js';

type AgentTruthDiagnosticsState = {
  fullTruthReadable: boolean;
};

const EMPTY_AGENT_TRUTH_DIAGNOSTICS: Record<string, AgentTruthDiagnosticsState> = {};

function summarizeAgentNames(agents: Array<Pick<LookdevAgentRecord, 'displayName'>>): string {
  if (agents.length <= 3) {
    return agents.map((agent) => agent.displayName).join(', ');
  }
  return `${agents.slice(0, 3).map((agent) => agent.displayName).join(', ')} +${agents.length - 3}`;
}

export default function CreateBatchPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const createBatch = useLookdevStore((state) => state.createBatch);
  const storedWorldStyleSessions = useLookdevStore((state) => state.worldStyleSessions);
  const storedWorldStylePacks = useLookdevStore((state) => state.worldStylePacks);
  const storedCaptureStates = useLookdevStore((state) => state.captureStates);
  const storedPortraitBriefs = useLookdevStore((state) => state.portraitBriefs);
  const saveWorldStyleSession = useLookdevStore((state) => state.saveWorldStyleSession);
  const saveWorldStylePack = useLookdevStore((state) => state.saveWorldStylePack);
  const saveCaptureState = useLookdevStore((state) => state.saveCaptureState);
  const savePortraitBrief = useLookdevStore((state) => state.savePortraitBrief);
  const runtimeProbe = useAppStore((state) => state.runtimeProbe);
  const setRouteSettingsOpen = useAppStore((state) => state.setRouteSettingsOpen);
  const [selectionSource, setSelectionSource] = useState<LookdevSelectionSource>('by_world');
  const [worldId, setWorldId] = useState('');
  const [name, setName] = useState('');
  const [scoreThreshold, setScoreThreshold] = useState('78');
  const [maxConcurrency, setMaxConcurrency] = useState('1');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [captureSelectionAgentIds, setCaptureSelectionAgentIds] = useState<string[]>([]);
  const [styleSession, setStyleSession] = useState<LookdevWorldStyleSession | null>(null);
  const [styleSessionInput, setStyleSessionInput] = useState('');
  const [styleSessionBusy, setStyleSessionBusy] = useState(false);
  const [styleSessionError, setStyleSessionError] = useState<string | null>(null);
  const [worldStylePack, setWorldStylePack] = useState<LookdevWorldStylePack | null>(null);
  const [showAdvancedStyleEditor, setShowAdvancedStyleEditor] = useState(false);
  const [selectedBriefAgentId, setSelectedBriefAgentId] = useState<string | null>(null);
  const [interactiveCaptureDrafts, setInteractiveCaptureDrafts] = useState<Record<string, string>>({});
  const [interactiveCaptureBusy, setInteractiveCaptureBusy] = useState(false);
  const [interactiveCaptureResetBusy, setInteractiveCaptureResetBusy] = useState(false);
  const [interactiveCaptureError, setInteractiveCaptureError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousSelectedAgentIdsRef = useRef<string[]>([]);
  const currentLanguage = normalizeLookdevLanguage(i18n.resolvedLanguage || i18n.language);
  const runtime = getPlatformClient().runtime;
  const {
    generationTargetKey,
    evaluationTargetKey,
    dialogueTarget: styleDialogueTarget,
  } = useLookdevRouteSettings();

  const worldsQuery = useQuery({
    queryKey: ['lookdev', 'worlds'],
    queryFn: listLookdevWorlds,
  });

  const agentsQuery = useQuery({
    queryKey: ['lookdev', 'agents'],
    queryFn: listLookdevAgents,
  });
  const worldAgentsQuery = useQuery({
    queryKey: ['lookdev', 'world-agents', worldId],
    enabled: selectionSource === 'by_world' && Boolean(worldId),
    queryFn: async () => await listLookdevWorldAgents(worldId),
  });
  const intakeLoading = worldsQuery.isLoading
    || (selectionSource === 'explicit_selection' && agentsQuery.isLoading)
    || (selectionSource === 'by_world' && Boolean(worldId) && worldAgentsQuery.isLoading);
  const intakeError = worldsQuery.error
    || (selectionSource === 'explicit_selection' ? agentsQuery.error : null)
    || (selectionSource === 'by_world' ? worldAgentsQuery.error : null);

  const selectableAgents = useMemo(
    () => (agentsQuery.data || []).filter((agent) => agent.worldId),
    [agentsQuery.data],
  );

  const worldAgents = useMemo(
    () => worldAgentsQuery.data || [],
    [worldAgentsQuery.data],
  );

  const explicitSelectedAgents = useMemo(
    () => selectableAgents.filter((agent) => selectedAgentIds.includes(agent.id)),
    [selectableAgents, selectedAgentIds],
  );

  const rawSelectedAgents = selectionSource === 'by_world' ? worldAgents : explicitSelectedAgents;
  const rawSelectedWorldIds = [...new Set(
    rawSelectedAgents
      .map((agent) => agent.worldId)
      .filter((worldId): worldId is string => Boolean(worldId)),
  )];
  const hasMixedWorldSelection = selectionSource === 'explicit_selection' && rawSelectedWorldIds.length > 1;
  const resolvedWorldId = selectionSource === 'by_world'
    ? worldId
    : (rawSelectedWorldIds.length === 1 ? (rawSelectedWorldIds[0] || '') : '');
  const agentTruthDiagnosticsQuery = useQuery({
    queryKey: ['lookdev', 'selected-agent-truth-diagnostics', resolvedWorldId, rawSelectedAgents.map((agent) => `${agent.worldId || 'unscoped'}::${agent.id}`)],
    enabled: Boolean(resolvedWorldId) && rawSelectedAgents.length > 0 && !hasMixedWorldSelection,
    queryFn: async () => {
      const entries = await Promise.all(rawSelectedAgents.map(async (agent) => {
        if (!agent.worldId || agent.worldId !== resolvedWorldId) {
          return [agent.id, { fullTruthReadable: false }] as const;
        }
        const context = await getLookdevAgentAuthoringContext(agent.worldId, agent.id).catch(() => null);
        return [agent.id, { fullTruthReadable: Boolean(context?.fullTruthReadable) }] as const;
      }));
      return Object.fromEntries(entries) as Record<string, AgentTruthDiagnosticsState>;
    },
  });
  const agentTruthDiagnostics = agentTruthDiagnosticsQuery.data || EMPTY_AGENT_TRUTH_DIAGNOSTICS;
  const agentTruthDiagnosticsPending = Boolean(resolvedWorldId)
    && rawSelectedAgents.length > 0
    && !hasMixedWorldSelection
    && (agentTruthDiagnosticsQuery.isLoading || agentTruthDiagnosticsQuery.isFetching);
  const selectedAgents = useMemo<LookdevSelectedAgent[]>(
    () => rawSelectedAgents.map((agent) => ({
      id: agent.id,
      handle: agent.handle,
      displayName: agent.displayName,
      concept: agent.concept,
      worldId: agent.worldId,
      avatarUrl: agent.avatarUrl,
      importance: agent.importance,
      status: agent.status,
    })),
    [rawSelectedAgents],
  );
  const limitedTruthAgents = useMemo(
    () => rawSelectedAgents.filter((agent) => agentTruthDiagnostics[agent.id]?.fullTruthReadable === false),
    [agentTruthDiagnostics, rawSelectedAgents],
  );
  const batchEligibleAgentIds = useMemo(
    () => new Set(selectedAgents.map((agent) => agent.id)),
    [selectedAgents],
  );
  const imageTargets = runtimeProbe.imageTargets;
  const visionTargets = runtimeProbe.visionTargets;
  const worldSelectionUnavailable = selectionSource === 'by_world'
    && Boolean(worldId)
    && !intakeLoading
    && !intakeError
    && rawSelectedAgents.length === 0;
  const resolvedWorldName = useMemo(
    () => worldsQuery.data?.find((world) => world.id === resolvedWorldId)?.name || t('createBatch.worldStyleSessionPendingWorldName'),
    [resolvedWorldId, t, worldsQuery.data],
  );
  const styleAgents = useMemo<Parameters<typeof createWorldStyleSession>[3]>(
    () => selectedAgents.map((agent) => ({
      displayName: agent.displayName,
      concept: String(agent.concept || '').trim(),
      importance: agent.importance,
    })),
    [selectedAgents],
  );
  const worldStyleWorkspaceInvalid = !resolvedWorldId
    || hasMixedWorldSelection
    || worldSelectionUnavailable
    || (!intakeLoading && !intakeError && rawSelectedAgents.length === 0);
  const worldStyleSessionBlockedMessage = hasMixedWorldSelection
    ? t('createBatch.multiWorldWarning')
    : worldSelectionUnavailable
      ? t('createBatch.worldCastUnavailable', { worldName: resolvedWorldName })
      : null;

  useEffect(() => {
    if (worldStyleWorkspaceInvalid) {
      setStyleSession(null);
      setWorldStylePack(null);
      setShowAdvancedStyleEditor(false);
      setStyleSessionInput('');
      setStyleSessionError(null);
      return;
    }
    const storedSession = storedWorldStyleSessions[resolvedWorldId];
    const storedPack = isCurrentWorldStylePack(storedWorldStylePacks[resolvedWorldId])
      ? storedWorldStylePacks[resolvedWorldId]
      : null;
    const compatibleStoredSession = storedSession?.language === currentLanguage ? storedSession : null;
    const compatibleStoredPack = storedPack?.language === currentLanguage ? storedPack : null;
    setStyleSession((current) => {
      if (current && current.worldId === resolvedWorldId && current.language === currentLanguage) {
        return current;
      }
      return compatibleStoredSession || createWorldStyleSession(
        resolvedWorldId,
        resolvedWorldName,
        currentLanguage,
        styleAgents,
      );
    });
    setWorldStylePack((current) => {
      if (current && current.worldId === resolvedWorldId && current.language === currentLanguage) {
        return current;
      }
      return compatibleStoredPack || null;
    });
    setShowAdvancedStyleEditor(Boolean(compatibleStoredPack));
    setStyleSessionInput('');
    setStyleSessionError(null);
  }, [currentLanguage, resolvedWorldId, resolvedWorldName, storedWorldStylePacks, storedWorldStyleSessions, styleAgents, worldStyleWorkspaceInvalid]);

  const stylePackConfirmed = worldStylePack?.status === 'confirmed';
  const styleSessionCanSynthesize = canSynthesizeWorldStyleSession(styleSession);

  useEffect(() => {
    const defaultCaptureIds = selectedAgents
      .filter((agent) => agent.importance === 'PRIMARY')
      .map((agent) => agent.id);
    const selectedAgentIdSet = new Set(selectedAgents.map((agent) => agent.id));
    const previousSelectedAgentIdSet = new Set(previousSelectedAgentIdsRef.current);
    setCaptureSelectionAgentIds((current) => {
      const retained = current.filter((agentId) => selectedAgentIdSet.has(agentId));
      const next = [...retained];
      defaultCaptureIds.forEach((agentId) => {
        if (!previousSelectedAgentIdSet.has(agentId) && !next.includes(agentId)) {
          next.push(agentId);
        }
      });
      if (current.length === next.length && current.every((agentId, index) => agentId === next[index])) {
        return current;
      }
      return next;
    });
    previousSelectedAgentIdsRef.current = selectedAgents.map((agent) => agent.id);
  }, [selectionSource, worldId, selectedAgentIds, selectedAgents]);

  useEffect(() => {
    const selectedAgentIdSet = new Set(selectedAgents.map((agent) => agent.id));
    const firstAgentId = captureSelectionAgentIds[0] || selectedAgents[0]?.id || null;
    if (!firstAgentId) {
      setSelectedBriefAgentId(null);
      return;
    }
    if (!selectedBriefAgentId || !selectedAgentIdSet.has(selectedBriefAgentId)) {
      setSelectedBriefAgentId(firstAgentId);
    }
  }, [captureSelectionAgentIds, selectedAgents, selectedBriefAgentId]);

  const {
    captureStates,
    captureStatesReady,
    captureSynthesisBusy,
    captureSynthesisError,
    portraitBriefs,
  } = useLookdevCaptureStateSynthesis({
    stylePackConfirmed,
    worldStylePack,
    styleDialogueTarget,
    selectedAgents,
    captureSelectionAgentIds,
    storedCaptureStates,
    storedPortraitBriefs,
    currentLanguage,
    runtime,
    saveCaptureState,
    savePortraitBrief,
  });

  const activeCaptureState = useMemo(
    () => captureStates.find((state) => state.agentId === selectedBriefAgentId) || captureStates[0] || null,
    [captureStates, selectedBriefAgentId],
  );
  const activePortraitBriefFieldPrefix = activeCaptureState ? `lookdev-brief-${activeCaptureState.agentId}` : 'lookdev-brief';
  const activeCaptureDraftKey = activeCaptureState ? createCaptureStateKey(activeCaptureState.worldId, activeCaptureState.agentId) : null;
  const interactiveCaptureInput = activeCaptureDraftKey ? (interactiveCaptureDrafts[activeCaptureDraftKey] || '') : '';

  const generationTarget = useMemo(
    () => {
      const target = imageTargets.find((entry) => entry.key === generationTargetKey);
      return target ? stripTargetKey(target) : null;
    },
    [generationTargetKey, imageTargets],
  );
  const evaluationTarget = useMemo(
    () => {
      const target = visionTargets.find((entry) => entry.key === evaluationTargetKey);
      return target ? stripTargetKey(target) : null;
    },
    [evaluationTargetKey, visionTargets],
  );
  const worldFieldOptions = useMemo<SelectFieldOption[]>(
    () => [
      ...((worldsQuery.data || []).map((world) => ({
        value: world.id,
        label: formatWorldOptionLabel(
          world.name,
          world.agentCount,
          typeof world.agentCount === 'number'
            ? t('createBatch.worldOptionCount', { count: world.agentCount, defaultValue: `${world.agentCount} agents` })
            : undefined,
        ),
      }))),
    ],
    [t, worldsQuery.data],
  );
  const captureSelectedCount = captureSelectionAgentIds.filter((agentId) => batchEligibleAgentIds.has(agentId)).length;
  const dialogueRouteSummary = styleDialogueTarget
    ? describeWorldStyleTarget(currentLanguage, styleDialogueTarget)
    : t('common.none');
  const generationRouteSummary = generationTarget
    ? formatTargetOptionLabel({ ...generationTarget, key: generationTargetKey } as RuntimeTargetOption, t('createBatch.localRuntimeLabel', { defaultValue: 'Local Runtime' }))
    : t('common.none');
  const evaluationRouteSummary = evaluationTarget
    ? formatTargetOptionLabel({ ...evaluationTarget, key: evaluationTargetKey } as RuntimeTargetOption, t('createBatch.localRuntimeLabel', { defaultValue: 'Local Runtime' }))
    : t('common.none');
  const batchWorldSummary = resolvedWorldId ? resolvedWorldName : t('common.none');
  const batchReady = !intakeLoading
    && !intakeError
    && !worldSelectionUnavailable
    && !hasMixedWorldSelection
    && Boolean(resolvedWorldId)
    && Boolean(stylePackConfirmed)
    && captureStatesReady
    && !captureSynthesisBusy
    && !interactiveCaptureResetBusy
    && Boolean(generationTarget)
    && Boolean(evaluationTarget);

  useEffect(() => {
    if (!error) {
      return;
    }
    setError(null);
  }, [
    agentTruthDiagnosticsPending,
    captureSelectionAgentIds,
    captureSynthesisBusy,
    captureStatesReady,
    evaluationTargetKey,
    generationTargetKey,
    hasMixedWorldSelection,
    intakeError,
    intakeLoading,
    interactiveCaptureResetBusy,
    maxConcurrency,
    name,
    resolvedWorldId,
    scoreThreshold,
    selectedAgentIds,
    selectionSource,
    stylePackConfirmed,
    worldId,
    worldSelectionUnavailable,
  ]);

  useEffect(() => {
    setInteractiveCaptureError(null);
  }, [activeCaptureDraftKey]);

  const styleSessionCtx = useMemo<Parameters<typeof doStyleSessionReply>[3]>(() => ({
    runtime,
    styleDialogueTarget,
    styleAgents,
    t,
    saveWorldStyleSession,
    saveWorldStylePack,
    setStyleSession: setStyleSession as (updater: LookdevWorldStyleSession | null | ((current: LookdevWorldStyleSession | null) => LookdevWorldStyleSession | null)) => void,
    setWorldStylePack: setWorldStylePack as (updater: LookdevWorldStylePack | null | ((current: LookdevWorldStylePack | null) => LookdevWorldStylePack | null)) => void,
    setShowAdvancedStyleEditor,
    setStyleSessionInput,
    setStyleSessionError,
    setStyleSessionBusy,
  }), [runtime, styleDialogueTarget, styleAgents, t, saveWorldStyleSession, saveWorldStylePack]);

  const interactiveCaptureCtx = useMemo<Parameters<typeof doInteractiveCaptureRefine>[4]>(() => ({
    runtime,
    styleDialogueTarget,
    currentLanguage,
    selectedAgents,
    saveCaptureState,
    savePortraitBrief,
    setInteractiveCaptureBusy,
    setInteractiveCaptureResetBusy,
    setInteractiveCaptureError,
    setInteractiveCaptureDrafts,
  }), [runtime, styleDialogueTarget, currentLanguage, selectedAgents, saveCaptureState, savePortraitBrief]);

  function updateWorldStylePack(patch: Partial<LookdevWorldStylePack>) {
    if (!worldStylePack) {
      return;
    }
    const next = {
      ...worldStylePack,
      ...patch,
      status: 'draft' as const,
      confirmedAt: null,
    };
    setWorldStylePack(next);
    saveWorldStylePack(next);
  }

  function updateCaptureVisualIntent(patch: Partial<LookdevCaptureState['visualIntent']>) {
    if (!activeCaptureState) {
      return;
    }
    const nextState: LookdevCaptureState = {
      ...activeCaptureState,
      visualIntent: {
        ...activeCaptureState.visualIntent,
        ...patch,
      },
      updatedAt: new Date().toISOString(),
    };
    saveCaptureState(nextState);
    savePortraitBrief(materializePortraitBriefFromCaptureState(nextState));
  }

  function toggleExplicitSelection(agentId: string) {
    setSelectedAgentIds((current) => current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId]);
  }

  function toggleCaptureSelection(agentId: string) {
    setCaptureSelectionAgentIds((current) => current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId]);
  }

  return (
    <div className="grid gap-5 pb-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <section className="ld-card px-7 py-7">
          <div className="flex flex-col gap-6">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.2em] text-[var(--ld-gold)]">{t('createBatch.eyebrow')}</div>
              <h2 className="text-3xl font-semibold text-white">{t('createBatch.title')}</h2>
              <p className="max-w-3xl text-sm leading-7 text-white/66">{t('createBatch.subtitle')}</p>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="grid gap-6">
                <div className="grid gap-2">
                  <label htmlFor="lookdev-batch-name" className="text-sm text-white/74">{t('createBatch.batchName')}</label>
                  <TextField
                    id="lookdev-batch-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t('createBatch.batchNamePlaceholder')}
                    aria-label={t('createBatch.batchName')}
                    className="rounded-2xl border-white/10 bg-black/12 text-white"
                    inputClassName="text-sm"
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Button
                    onClick={() => setSelectionSource('by_world')}
                    tone="secondary"
                    className={`rounded-3xl px-4 py-4 text-left ${selectionSource === 'by_world' ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/10 bg-black/12 text-white/72'}`}
                    fullWidth
                  >
                    <div className="text-sm font-medium">{t('createBatch.selectionByWorldTitle')}</div>
                    <div className="mt-1 text-xs leading-5 text-white/56">{t('createBatch.selectionByWorldDescription')}</div>
                  </Button>
                  <Button
                    onClick={() => setSelectionSource('explicit_selection')}
                    tone="secondary"
                    className={`rounded-3xl px-4 py-4 text-left ${selectionSource === 'explicit_selection' ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/10 bg-black/12 text-white/72'}`}
                    fullWidth
                  >
                    <div className="text-sm font-medium">{t('createBatch.selectionExplicitTitle')}</div>
                    <div className="mt-1 text-xs leading-5 text-white/56">{t('createBatch.selectionExplicitDescription')}</div>
                  </Button>
                </div>

                {selectionSource === 'by_world' ? (
                  <div className="grid gap-2">
                    <label htmlFor="lookdev-world-select" className="text-sm text-white/74">{t('createBatch.world')}</label>
                    <SelectField
                      id="lookdev-world-select"
                      value={worldId}
                      options={worldFieldOptions}
                      placeholder={t('createBatch.selectWorld')}
                      onValueChange={setWorldId}
                      aria-label={t('createBatch.world')}
                      className="rounded-2xl border-white/10 bg-black/12 text-white"
                      contentClassName="bg-[rgb(11_18_32)]"
                    />
                    {worldId ? (
                      <div className={`rounded-2xl border px-4 py-3 text-sm ${worldSelectionUnavailable ? 'border-amber-300/20 bg-amber-300/10 text-amber-50' : 'border-white/8 bg-black/14 text-white/66'}`}>
                        {t('createBatch.frozenSelectionPreview', { count: selectedAgents.length, worldName: resolvedWorldName })}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <label className="text-sm text-white/74">{t('createBatch.agents')}</label>
                    <div className="max-h-[320px] space-y-2 overflow-auto pr-1 ld-scroll">
                      {selectableAgents.map((agent) => {
                        const selected = batchEligibleAgentIds.has(agent.id);
                        const selectedRaw = selectedAgentIds.includes(agent.id);
                        const limitedTruth = agentTruthDiagnostics[agent.id]?.fullTruthReadable === false;
                        const checking = selectedRaw && agentTruthDiagnosticsPending && !Object.prototype.hasOwnProperty.call(agentTruthDiagnostics, agent.id);
                        return (
                          <Button
                            key={agent.id}
                            onClick={() => toggleExplicitSelection(agent.id)}
                            tone="secondary"
                            className={`flex w-full items-start justify-between rounded-2xl px-4 py-3 text-left ${selected && limitedTruth ? 'border-amber-300/20 bg-amber-300/10 text-amber-50' : selected ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/8 bg-black/12 text-white/72'}`}
                            fullWidth
                          >
                            <div>
                              <div className="font-medium text-white">{agent.displayName}</div>
                              <div className="mt-1 text-xs text-white/52">{agent.handle || agent.id} · {agent.worldId} · {t(`importance.${agent.importance}`, { defaultValue: agent.importance })}</div>
                              {agent.concept ? <div className="mt-2 text-xs leading-5 text-white/58">{agent.concept}</div> : null}
                            </div>
                            <span className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">
                              {checking
                                  ? t('createBatch.checkingLabel')
                                  : limitedTruth
                                    ? t('createBatch.limitedTruthLabel')
                                    : selected
                                      ? t('createBatch.inBatchLabel')
                                      : t('createBatch.selectLabel')}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-3 content-start">
                <div className="rounded-3xl border border-white/8 bg-black/14 px-5 py-5">
                  <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('createBatch.intakeSummaryEyebrow')}</div>
                  <div className="mt-2 text-sm leading-6 text-white/64">{t('createBatch.intakeSummaryDescription')}</div>
                  <div className="mt-4 grid gap-3">
                    <div className="rounded-2xl border border-white/8 bg-black/12 px-4 py-3 text-sm text-white/70">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{t('createBatch.reviewWorld')}</div>
                      <div className="mt-1 text-base text-white">{batchWorldSummary}</div>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-black/12 px-4 py-3 text-sm text-white/70">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{t('createBatch.reviewAgents')}</div>
                      <div className="mt-1 text-base text-white">{selectedAgents.length}</div>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-black/12 px-4 py-3 text-sm text-white/70">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{t('createBatch.reviewLimitedTruthAgents')}</div>
                      <div className="mt-1 text-base text-white">{limitedTruthAgents.length}</div>
                    </div>
                  </div>
                </div>

                {intakeLoading ? (
                  <div className="rounded-2xl border border-white/8 bg-black/14 px-4 py-4 text-sm text-white/64">
                    {t('createBatch.intakeLoading')}
                  </div>
                ) : null}

                {intakeError ? (
                  <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-4 text-sm text-rose-100">
                    {t('createBatch.intakeUnavailable')}
                  </div>
                ) : null}

                {agentTruthDiagnosticsPending ? (
                  <div className="rounded-2xl border border-white/8 bg-black/14 px-4 py-3 text-sm text-white/66">
                    {t('createBatch.truthDiagnosticsLoading')}
                  </div>
                ) : null}

                {!agentTruthDiagnosticsPending && limitedTruthAgents.length > 0 ? (
                  <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                    {selectionSource === 'by_world'
                      ? t('createBatch.truthLimitedByWorld', {
                        count: limitedTruthAgents.length,
                        agents: summarizeAgentNames(limitedTruthAgents),
                      })
                      : t('createBatch.truthLimitedExplicit', {
                        count: limitedTruthAgents.length,
                        agents: summarizeAgentNames(limitedTruthAgents),
                      })}
                  </div>
                ) : null}

                {worldSelectionUnavailable ? (
                  <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                    {t('createBatch.worldCastUnavailable', { worldName: resolvedWorldName })}
                  </div>
                ) : null}

                {rawSelectedWorldIds.length > 1 ? (
                  <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                    {t('createBatch.multiWorldWarning')}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <WorldStyleSessionPanel
          worldName={resolvedWorldName}
          worldSelected={Boolean(resolvedWorldId)}
          blockedMessage={worldStyleSessionBlockedMessage}
          styleSession={styleSession}
          styleSessionInput={styleSessionInput}
          worldStylePack={worldStylePack}
          stylePackConfirmed={stylePackConfirmed}
          styleSessionCanSynthesize={styleSessionCanSynthesize}
          styleSessionBusy={styleSessionBusy}
          styleSessionError={styleSessionError}
          styleSessionTargetReady={Boolean(styleDialogueTarget)}
          showAdvancedStyleEditor={showAdvancedStyleEditor}
          onStyleSessionInputChange={setStyleSessionInput}
          onOpenRouteSettings={() => setRouteSettingsOpen(true)}
          onStyleSessionReply={() => void (styleSession && doStyleSessionReply(styleSession, styleSessionInput, worldStylePack, styleSessionCtx))}
          onRestartStyleSession={() => doRestartStyleSession(resolvedWorldId, resolvedWorldName, currentLanguage, styleSessionCtx)}
          onSynthesizeStylePack={() => void (styleSession && doSynthesizeStylePack(styleSession, worldStylePack, styleSessionCtx))}
          onConfirmWorldStylePack={() => doConfirmWorldStylePack(worldStylePack, setWorldStylePack, saveWorldStylePack)}
          onToggleAdvancedStyleEditor={() => setShowAdvancedStyleEditor((current) => !current)}
          onUpdateWorldStylePack={updateWorldStylePack}
        />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
          <CaptureSelectionPanel
            stylePackConfirmed={stylePackConfirmed}
            selectedAgents={selectedAgents}
            captureSelectionAgentIds={captureSelectionAgentIds}
            onToggleCaptureSelection={toggleCaptureSelection}
          />

          <EmbeddedCapturePanel
            stylePackConfirmed={stylePackConfirmed}
            captureSynthesisBusy={captureSynthesisBusy}
            captureSynthesisError={captureSynthesisError}
            captureStates={captureStates}
            activeCaptureState={activeCaptureState}
            activePortraitBriefFieldPrefix={activePortraitBriefFieldPrefix}
            onSelectBriefAgent={setSelectedBriefAgentId}
            interactiveCaptureInput={interactiveCaptureInput}
            interactiveCaptureBusy={interactiveCaptureBusy}
            interactiveCaptureResetBusy={interactiveCaptureResetBusy}
            interactiveCaptureError={interactiveCaptureError}
            onInteractiveCaptureInputChange={(value) => {
              if (!activeCaptureDraftKey) {
                return;
              }
              setInteractiveCaptureError(null);
              setInteractiveCaptureDrafts((current) => ({
                ...current,
                [activeCaptureDraftKey]: value,
              }));
            }}
            onRunInteractiveCaptureRefine={() => void doInteractiveCaptureRefine(activeCaptureState, worldStylePack, activeCaptureDraftKey, interactiveCaptureInput, interactiveCaptureCtx)}
            onResetInteractiveCapture={() => void doResetInteractiveCapture(activeCaptureState, worldStylePack, activeCaptureDraftKey, interactiveCaptureCtx)}
            onUpdateCaptureVisualIntent={updateCaptureVisualIntent}
          />
        </div>
      </div>

      <div className="space-y-5 self-start 2xl:sticky 2xl:top-5">
        <section className="ld-card px-6 py-6">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--ld-gold)]">{t('createBatch.reviewEyebrow')}</div>
            <h3 className="text-2xl font-semibold text-white">{t('createBatch.reviewTitle')}</h3>
            <p className="text-sm leading-6 text-white/60">{t('createBatch.reviewDescription')}</p>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="rounded-2xl border border-white/8 bg-black/12 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{t('createBatch.batchName')}</div>
              <div className="mt-1 text-sm text-white">{name.trim() || t('createBatch.batchNamePlaceholder')}</div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/12 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{t('createBatch.reviewWorld')}</div>
              <div className="mt-1 text-sm text-white">{batchWorldSummary}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
              <div className="rounded-2xl border border-white/8 bg-black/12 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{t('createBatch.reviewAgents')}</div>
                <div className="mt-1 text-2xl font-semibold text-white">{selectedAgents.length}</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/12 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{t('createBatch.reviewCapture')}</div>
                <div className="mt-1 text-2xl font-semibold text-white">{captureSelectedCount}</div>
              </div>
            </div>
            <div className={`rounded-2xl border px-4 py-3 text-sm ${limitedTruthAgents.length > 0 ? 'border-amber-300/20 bg-amber-300/10 text-amber-50' : 'border-white/8 bg-black/12 text-white/66'}`}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-current/70">{t('createBatch.reviewLimitedTruthAgents')}</div>
              <div className="mt-1">
                {limitedTruthAgents.length > 0
                  ? t('createBatch.reviewLimitedTruthAgentsHint', { count: limitedTruthAgents.length, agents: summarizeAgentNames(limitedTruthAgents) })
                  : t('createBatch.reviewLimitedTruthAgentsNone')}
              </div>
            </div>
            <div className={`rounded-2xl border px-4 py-3 text-sm ${stylePackConfirmed ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-50' : 'border-amber-300/20 bg-amber-300/10 text-amber-50'}`}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-current/70">{t('createBatch.reviewStylePack')}</div>
              <div className="mt-1">{stylePackConfirmed ? t('createBatch.reviewStylePackReady') : t('createBatch.reviewStylePackPending')}</div>
            </div>
            <div className={`rounded-2xl border px-4 py-3 text-sm ${captureStatesReady && !captureSynthesisBusy && !interactiveCaptureResetBusy ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-50' : 'border-white/8 bg-black/12 text-white/66'}`}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-current/70">{t('createBatch.reviewCaptureState')}</div>
              <div className="mt-1">
                {captureSynthesisBusy || interactiveCaptureResetBusy
                  ? t('createBatch.reviewCaptureStateBusy')
                  : captureStatesReady
                    ? t('createBatch.reviewCaptureStateReady')
                    : t('createBatch.reviewCaptureStatePending')}
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/12 px-4 py-3 text-sm text-white/70">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">{t('createBatch.reviewDialogueTarget')}</div>
              <div className="mt-1 text-white">{dialogueRouteSummary}</div>
            </div>
            <div className={`rounded-2xl border px-4 py-3 text-sm ${batchReady ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-50' : 'border-white/8 bg-black/12 text-white/66'}`}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-current/70">{t('createBatch.reviewReadiness')}</div>
              <div className="mt-1">
                {batchReady ? t('createBatch.reviewReady') : t('createBatch.reviewPending')}
              </div>
            </div>
          </div>
        </section>

        <CreateBatchPolicyPanel
          dialogueRouteLabel={dialogueRouteSummary}
          generationRouteLabel={generationRouteSummary}
          evaluationRouteLabel={evaluationRouteSummary}
          dialogueRouteReady={Boolean(styleDialogueTarget)}
          generationRouteReady={Boolean(generationTarget)}
          evaluationRouteReady={Boolean(evaluationTarget)}
          scoreThreshold={scoreThreshold}
          maxConcurrency={maxConcurrency}
          saving={saving}
          error={error}
          disabled={saving || intakeLoading || Boolean(intakeError) || !stylePackConfirmed || !captureStatesReady || captureSynthesisBusy || interactiveCaptureResetBusy || worldSelectionUnavailable || hasMixedWorldSelection || !generationTarget || !evaluationTarget}
          onOpenRouteSettings={() => setRouteSettingsOpen(true)}
          onScoreThresholdChange={setScoreThreshold}
          onMaxConcurrencyChange={setMaxConcurrency}
          onCreate={() => void doCreate({
            intakeLoading, intakeError, worldSelectionUnavailable, rawSelectedAgents, rawSelectedWorldIds,
            resolvedWorldId, resolvedWorldName, worldStylePack, stylePackConfirmed, captureSynthesisBusy,
            interactiveCaptureResetBusy, captureStatesReady, generationTarget, evaluationTarget,
            styleSession, captureStates, portraitBriefs, name, selectionSource, selectedAgents,
            captureSelectionAgentIds, maxConcurrency, scoreThreshold,
            ctx: { t, navigate, createBatch, saveWorldStylePack, saveWorldStyleSession, saveCaptureState, savePortraitBrief, setSaving, setError },
          })}
        />
      </div>
    </div>
  );
}
