import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import { Button, SelectField, TextField, type SelectFieldOption } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { getAgentPortraitBinding, getLookdevAgentTruthBundle, listLookdevAgents, listLookdevWorldAgents, listLookdevWorlds } from '@renderer/data/lookdev-data-client.js';
import type { LookdevAgentRecord } from '@renderer/data/lookdev-data-client.js';
import { useAppStore, type RuntimeTargetOption } from '@renderer/app-shell/providers/app-store.js';
import { useLookdevStore } from './lookdev-store.js';
import {
  confirmWorldStylePack,
  type LookdevCaptureState,
  normalizeLookdevLanguage,
  type LookdevSelectionSource,
  type LookdevWorldStylePack,
  type LookdevWorldStyleSession,
} from './types.js';
import {
  materializePortraitBriefFromCaptureState,
  runInteractiveCaptureTurn,
} from './capture-harness.js';
import {
  appendWorldStyleSessionAnswer,
  canSynthesizeWorldStyleSession,
  createWorldStyleSession,
  describeWorldStyleTarget,
  markWorldStyleSessionSynthesized,
  synthesizeWorldStylePackFromSession,
} from './world-style-session.js';
import { WorldStyleSessionPanel } from './world-style-session-panel.js';
import { CaptureSelectionPanel } from './capture-selection-panel.js';
import { EmbeddedCapturePanel } from './embedded-capture-panel.js';
import { CreateBatchPolicyPanel } from './create-batch-policy-panel.js';
import {
  formatTargetOptionLabel,
  formatWorldOptionLabel,
  isCurrentWorldStylePack,
  pickConfiguredRuntimeTargetKey,
  stripTargetKey,
  toErrorMessage,
  withLookdevBatchAgentFields,
} from './create-batch-page-helpers.js';
import { useLookdevCaptureStateSynthesis } from './use-lookdev-capture-state-synthesis.js';

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
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const runtimeProbe = useAppStore((state) => state.runtimeProbe);
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
  const [styleDialogueTargetKey, setStyleDialogueTargetKey] = useState('');
  const [generationTargetKey, setGenerationTargetKey] = useState('');
  const [evaluationTargetKey, setEvaluationTargetKey] = useState('');
  const [interactiveCaptureInput, setInteractiveCaptureInput] = useState('');
  const [interactiveCaptureBusy, setInteractiveCaptureBusy] = useState(false);
  const [interactiveCaptureError, setInteractiveCaptureError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousSelectedAgentIdsRef = useRef<string[]>([]);
  const currentLanguage = normalizeLookdevLanguage(i18n.resolvedLanguage || i18n.language);
  const runtime = getPlatformClient().runtime;

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
  const worldSelectionUnavailable = selectionSource === 'by_world'
    && Boolean(worldId)
    && !intakeLoading
    && !intakeError
    && worldAgents.length === 0;

  const explicitSelectedAgents = useMemo(
    () => selectableAgents.filter((agent) => selectedAgentIds.includes(agent.id)),
    [selectableAgents, selectedAgentIds],
  );

  const selectedAgents = selectionSource === 'by_world' ? worldAgents : explicitSelectedAgents;
  const textTargets = runtimeProbe.textTargets;
  const imageTargets = runtimeProbe.imageTargets;
  const visionTargets = runtimeProbe.visionTargets;
  const selectedWorldIds = [...new Set(selectedAgents.map((agent) => agent.worldId).filter(Boolean))];
  const hasMixedWorldSelection = selectionSource === 'explicit_selection' && selectedWorldIds.length > 1;
  const resolvedWorldId = selectionSource === 'by_world'
    ? worldId
    : (selectedWorldIds.length === 1 ? (selectedWorldIds[0] || '') : '');
  const resolvedWorldName = useMemo(
    () => worldsQuery.data?.find((world) => world.id === resolvedWorldId)?.name || t('createBatch.worldStyleSessionPendingWorldName'),
    [resolvedWorldId, t, worldsQuery.data],
  );
  const styleAgents = useMemo(
    () => selectedAgents.map((agent) => ({
      displayName: agent.displayName,
      concept: agent.concept,
      importance: agent.importance,
    })),
    [selectedAgents],
  );

  useEffect(() => {
    if (!resolvedWorldId) {
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
    setStyleSession((current) => {
      if (current && current.worldId === resolvedWorldId) {
        return current;
      }
      return storedSession || createWorldStyleSession(
        resolvedWorldId,
        resolvedWorldName,
        currentLanguage,
        styleAgents,
      );
    });
    setWorldStylePack((current) => {
      if (current && current.worldId === resolvedWorldId) {
        return current;
      }
      return storedPack || null;
    });
    setShowAdvancedStyleEditor(Boolean(storedPack));
    setStyleSessionInput('');
    setStyleSessionError(null);
  }, [currentLanguage, resolvedWorldId, resolvedWorldName, storedWorldStylePacks, storedWorldStyleSessions, styleAgents]);

  useEffect(() => {
    const hasCurrentDialogueTarget = textTargets.some((target) => target.key === styleDialogueTargetKey);
    if (!hasCurrentDialogueTarget) {
      setStyleDialogueTargetKey(pickConfiguredRuntimeTargetKey({
        targets: textTargets,
        defaultTargetKey: runtimeProbe.textDefaultTargetKey,
        runtimeConnectorId: runtimeDefaults?.runtime.connectorId || runtimeProbe.textConnectorId,
        runtimeProvider: runtimeDefaults?.runtime.provider,
        localModelId: runtimeDefaults?.runtime.localProviderModel,
      }));
    }
  }, [
    runtimeDefaults?.runtime.connectorId,
    runtimeDefaults?.runtime.localProviderModel,
    runtimeDefaults?.runtime.provider,
    runtimeProbe.textConnectorId,
    runtimeProbe.textDefaultTargetKey,
    styleDialogueTargetKey,
    textTargets,
  ]);

  useEffect(() => {
    const hasCurrentGenerationTarget = imageTargets.some((target) => target.key === generationTargetKey);
    if (!hasCurrentGenerationTarget) {
      setGenerationTargetKey(runtimeProbe.imageDefaultTargetKey || imageTargets[0]?.key || '');
    }
  }, [generationTargetKey, imageTargets, runtimeProbe.imageDefaultTargetKey]);

  useEffect(() => {
    const hasCurrentEvaluationTarget = visionTargets.some((target) => target.key === evaluationTargetKey);
    if (!hasCurrentEvaluationTarget) {
      setEvaluationTargetKey(runtimeProbe.visionDefaultTargetKey || visionTargets[0]?.key || '');
    }
  }, [evaluationTargetKey, runtimeProbe.visionDefaultTargetKey, visionTargets]);

  const styleDialogueTarget = useMemo(
    () => textTargets.find((target) => target.key === styleDialogueTargetKey) || null,
    [styleDialogueTargetKey, textTargets],
  );
  const styleDialogueTargetOptions = useMemo(
    () => textTargets.map((target) => ({
      key: target.key,
      label: formatTargetOptionLabel(target, t('createBatch.localRuntimeLabel', { defaultValue: 'Local Runtime' })),
    })),
    [t, textTargets],
  );

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
        label: formatWorldOptionLabel(world.name, world.agentCount),
      }))),
    ],
    [t, worldsQuery.data],
  );

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

  async function handleStyleSessionReply() {
    if (!styleSession) {
      return;
    }
    setStyleSessionBusy(true);
    setStyleSessionError(null);
    try {
      const nextSession = await appendWorldStyleSessionAnswer({
        runtime,
        target: styleDialogueTarget,
        session: styleSession,
        answer: styleSessionInput,
        agents: styleAgents,
      });
      setStyleSession(nextSession);
      saveWorldStyleSession(nextSession);
      setStyleSessionInput('');
      if (worldStylePack) {
        const invalidatedPack = {
          ...worldStylePack,
          status: 'draft' as const,
          confirmedAt: null,
          sourceSessionId: nextSession.sessionId,
          summary: nextSession.summary || worldStylePack.summary,
          updatedAt: new Date().toISOString(),
        };
        setWorldStylePack(invalidatedPack);
        saveWorldStylePack(invalidatedPack);
        setShowAdvancedStyleEditor(true);
      } else {
        setWorldStylePack(null);
        setShowAdvancedStyleEditor(false);
      }
    } catch (nextError) {
      setStyleSessionError(toErrorMessage(nextError, t));
    } finally {
      setStyleSessionBusy(false);
    }
  }

  function handleRestartStyleSession() {
    if (!resolvedWorldId) {
      return;
    }
    const nextSession = createWorldStyleSession(
      resolvedWorldId,
      resolvedWorldName,
      currentLanguage,
      styleAgents,
    );
    setStyleSession(nextSession);
    saveWorldStyleSession(nextSession);
    setWorldStylePack(null);
    setShowAdvancedStyleEditor(false);
    setStyleSessionInput('');
    setStyleSessionError(null);
  }

  async function handleSynthesizeStylePack() {
    if (!styleSession) {
      return;
    }
    setStyleSessionBusy(true);
    setStyleSessionError(null);
    try {
      const nextPack = await synthesizeWorldStylePackFromSession({
        runtime,
        target: styleDialogueTarget,
        session: styleSession,
        agents: styleAgents,
        existingPack: worldStylePack,
      });
      const nextSession = markWorldStyleSessionSynthesized(styleSession, nextPack.summary);
      setStyleSession(nextSession);
      saveWorldStyleSession(nextSession);
      setWorldStylePack(nextPack);
      saveWorldStylePack(nextPack);
      setShowAdvancedStyleEditor(true);
    } catch (nextError) {
      setStyleSessionError(toErrorMessage(nextError, t));
    } finally {
      setStyleSessionBusy(false);
    }
  }

  function handleConfirmWorldStylePack() {
    if (!worldStylePack) {
      return;
    }
    const confirmedPack = confirmWorldStylePack(worldStylePack);
    setWorldStylePack(confirmedPack);
    saveWorldStylePack(confirmedPack);
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

  async function handleInteractiveCaptureRefine() {
    if (!activeCaptureState || !worldStylePack) {
      return;
    }
    const agent = selectedAgents.find((entry) => entry.id === activeCaptureState.agentId);
    if (!agent) {
      return;
    }
    setInteractiveCaptureBusy(true);
    setInteractiveCaptureError(null);
    try {
      if (!agent.worldId) {
        throw new Error('LOOKDEV_WORLD_ID_REQUIRED');
      }
      const [detail, portraitBinding] = await Promise.all([
        getLookdevAgentTruthBundle(agent.worldId, agent.id),
        getAgentPortraitBinding(agent.worldId, agent.id),
      ]);
      const nextState = await runInteractiveCaptureTurn({
        runtime,
        target: styleDialogueTarget,
        language: currentLanguage,
        agent: {
          id: agent.id,
          displayName: agent.displayName,
          concept: agent.concept,
          description: detail.description,
          truthBundle: detail,
          worldId: agent.worldId,
          importance: agent.importance,
          existingPortraitUrl: portraitBinding?.url || null,
        },
        worldStylePack,
        state: activeCaptureState,
        userMessage: interactiveCaptureInput,
      });
      saveCaptureState(nextState);
      savePortraitBrief(materializePortraitBriefFromCaptureState(nextState));
      setInteractiveCaptureInput('');
    } catch (captureError) {
      setInteractiveCaptureError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      setInteractiveCaptureBusy(false);
    }
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

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      if (intakeLoading) {
        throw new Error(t('createBatch.errorIntakeLoading'));
      }
      if (intakeError) {
        throw new Error(t('createBatch.errorIntakeUnavailable'));
      }
      if (worldSelectionUnavailable) {
        throw new Error(t('createBatch.errorWorldCastUnavailable', { worldName: resolvedWorldName }));
      }
      if (selectedAgents.length === 0) {
        throw new Error(t('createBatch.errorAgentsRequired'));
      }
      if (selectedWorldIds.length > 1) {
        throw new Error(t('createBatch.errorSingleWorldRequired'));
      }
      if (!resolvedWorldId || !worldStylePack) {
        throw new Error(t('createBatch.errorWorldRequired'));
      }
      if (!stylePackConfirmed) {
        throw new Error(t('createBatch.errorStylePackConfirmationRequired'));
      }
      if (captureSynthesisBusy) {
        throw new Error(t('createBatch.errorCaptureStatePending', { defaultValue: 'Capture-state synthesis is still running.' }));
      }
      if (!captureStatesReady) {
        throw new Error(t('createBatch.errorCaptureStateRequired', { defaultValue: 'Every selected agent needs a capture state before batch creation.' }));
      }
      if (!generationTarget) {
        throw new Error(t('createBatch.errorGenerationTargetRequired'));
      }
      if (!evaluationTarget) {
        throw new Error(t('createBatch.errorEvaluationTargetRequired'));
      }
      saveWorldStylePack(worldStylePack);
      if (styleSession) {
        saveWorldStyleSession(styleSession);
      }
      captureStates.forEach((state) => saveCaptureState(state));
      portraitBriefs.forEach((brief) => savePortraitBrief(brief));
      const batchId = await createBatch({
        name,
        selectionSource,
        agents: selectedAgents.map(withLookdevBatchAgentFields),
        worldId: resolvedWorldId,
        worldStylePack: worldStylePack,
        captureSelectionAgentIds,
        generationTarget,
        evaluationTarget,
        maxConcurrency: Number(maxConcurrency),
        scoreThreshold: Number(scoreThreshold),
      });
      navigate(`/batches/${batchId}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="ld-card px-7 py-7">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--ld-gold)]">{t('createBatch.eyebrow')}</div>
          <h2 className="text-3xl font-semibold text-white">{t('createBatch.title')}</h2>
        </div>

        <div className="mt-8 grid gap-6">
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
                  {t('createBatch.frozenSelectionPreview', { count: worldAgents.length, worldName: resolvedWorldName })}
                </div>
              ) : null}
              {worldSelectionUnavailable ? (
                <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                  {t('createBatch.worldCastUnavailable', { worldName: resolvedWorldName })}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3">
              <label className="text-sm text-white/74">{t('createBatch.agents')}</label>
              <div className="max-h-[320px] space-y-2 overflow-auto pr-1 ld-scroll">
                {selectableAgents.map((agent) => {
                  const selected = selectedAgentIds.includes(agent.id);
                  return (
                    <Button
                      key={agent.id}
                      onClick={() => toggleExplicitSelection(agent.id)}
                      tone="secondary"
                      className={`flex w-full items-start justify-between rounded-2xl px-4 py-3 text-left ${selected ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/8 bg-black/12 text-white/72'}`}
                      fullWidth
                    >
                      <div>
                        <div className="font-medium text-white">{agent.displayName}</div>
                        <div className="mt-1 text-xs text-white/52">{agent.handle || agent.id} · {agent.worldId} · {t(`importance.${agent.importance}`, { defaultValue: agent.importance })}</div>
                        {agent.concept ? <div className="mt-2 text-xs leading-5 text-white/58">{agent.concept}</div> : null}
                      </div>
                      <span className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">{selected ? t('createBatch.inBatchLabel') : t('createBatch.selectLabel')}</span>
                    </Button>
                  );
                })}
              </div>
              {selectedWorldIds.length > 1 ? (
                <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                  {t('createBatch.multiWorldWarning')}
                </div>
              ) : null}
            </div>
          )}

          <WorldStyleSessionPanel
            worldName={resolvedWorldName}
            worldSelected={Boolean(resolvedWorldId)}
            styleSession={styleSession}
            styleSessionInput={styleSessionInput}
            worldStylePack={worldStylePack}
            stylePackConfirmed={stylePackConfirmed}
            styleSessionCanSynthesize={styleSessionCanSynthesize}
            styleSessionBusy={styleSessionBusy}
            styleSessionError={styleSessionError}
            styleSessionTargetKey={styleDialogueTargetKey}
            styleSessionTargetLabel={describeWorldStyleTarget(currentLanguage, styleDialogueTarget)}
            styleSessionTargetReady={Boolean(styleDialogueTarget)}
            styleSessionTargetOptions={styleDialogueTargetOptions}
            showAdvancedStyleEditor={showAdvancedStyleEditor}
            onStyleSessionInputChange={setStyleSessionInput}
            onStyleSessionTargetChange={setStyleDialogueTargetKey}
            onStyleSessionReply={() => void handleStyleSessionReply()}
            onRestartStyleSession={handleRestartStyleSession}
            onSynthesizeStylePack={() => void handleSynthesizeStylePack()}
            onConfirmWorldStylePack={handleConfirmWorldStylePack}
            onToggleAdvancedStyleEditor={() => setShowAdvancedStyleEditor((current) => !current)}
            onUpdateWorldStylePack={updateWorldStylePack}
          />

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
            interactiveCaptureError={interactiveCaptureError}
            onInteractiveCaptureInputChange={setInteractiveCaptureInput}
            onRunInteractiveCaptureRefine={() => void handleInteractiveCaptureRefine()}
            onUpdateCaptureVisualIntent={updateCaptureVisualIntent}
          />
        </div>
      </section>

      <CreateBatchPolicyPanel
        imageTargets={imageTargets.map((target) => ({
          key: target.key,
          label: formatTargetOptionLabel(target, t('createBatch.localRuntimeLabel', { defaultValue: 'Local Runtime' })),
        }))}
        visionTargets={visionTargets.map((target) => ({
          key: target.key,
          label: formatTargetOptionLabel(target, t('createBatch.localRuntimeLabel', { defaultValue: 'Local Runtime' })),
        }))}
        generationTargetKey={generationTargetKey}
        evaluationTargetKey={evaluationTargetKey}
        scoreThreshold={scoreThreshold}
        maxConcurrency={maxConcurrency}
        saving={saving}
        error={error}
        disabled={saving || intakeLoading || Boolean(intakeError) || !stylePackConfirmed || !captureStatesReady || captureSynthesisBusy || worldSelectionUnavailable || hasMixedWorldSelection || !generationTarget || !evaluationTarget}
        onGenerationTargetChange={setGenerationTargetKey}
        onEvaluationTargetChange={setEvaluationTargetKey}
        onScoreThresholdChange={setScoreThreshold}
        onMaxConcurrencyChange={setMaxConcurrency}
        onCreate={() => void handleCreate()}
      />
    </div>
  );
}
