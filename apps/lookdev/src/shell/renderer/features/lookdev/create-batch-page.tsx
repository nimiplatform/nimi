import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { listLookdevAgents, listLookdevWorldAgents, listLookdevWorlds } from '@renderer/data/lookdev-data-client.js';
import type { LookdevAgentRecord } from '@renderer/data/lookdev-data-client.js';
import { useAppStore, type RuntimeTargetOption } from '@renderer/app-shell/providers/app-store.js';
import { useLookdevStore } from './lookdev-store.js';
import { compilePortraitBrief } from './prompting.js';
import {
  confirmWorldStylePack,
  normalizeLookdevLanguage,
  type LookdevPortraitBrief,
  type LookdevSelectionSource,
  type LookdevWorldStylePack,
  type LookdevWorldStyleSession,
} from './types.js';
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

function portraitBriefKey(worldId: string | null | undefined, agentId: string): string {
  return `${String(worldId || 'unscoped').trim() || 'unscoped'}::${agentId}`;
}

function formatWorldOptionLabel(name: string, agentCount: number | null): string {
  return typeof agentCount === 'number' ? `${name} · ${agentCount} agents` : name;
}

function stripTargetKey(target: RuntimeTargetOption): Omit<RuntimeTargetOption, 'key'> {
  const { key: _ignored, ...snapshot } = target;
  return snapshot;
}

function formatTargetOptionLabel(target: RuntimeTargetOption, localLabel: string): string {
  if (target.route === 'local') {
    return `${localLabel} / ${target.modelLabel || target.localModelId || target.modelId}`;
  }
  const connector = target.connectorLabel || target.provider || target.connectorId;
  const model = target.modelLabel || target.modelId;
  return `${connector} / ${model}`;
}

function isCurrentWorldStylePack(
  pack: LookdevWorldStylePack | null | undefined,
): pack is LookdevWorldStylePack {
  return Boolean(
    pack
    && typeof pack.language === 'string'
    && typeof pack.status === 'string'
    && typeof pack.summary === 'string'
    && typeof pack.seedSource === 'string'
    && Array.isArray(pack.forbiddenElements),
  );
}

function withLookdevBatchAgentFields(
  agent: Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'>,
): LookdevAgentRecord {
  return {
    ...agent,
    description: null,
    scenario: null,
    greeting: null,
    currentPortrait: null,
  };
}

function toErrorMessage(error: unknown, t: TFunction): string {
  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case 'LOOKDEV_STYLE_SESSION_REPLY_REQUIRED':
      return t('createBatch.errorStyleSessionReplyRequired');
    case 'LOOKDEV_STYLE_DIALOGUE_TARGET_REQUIRED':
      return t('createBatch.errorStyleSessionTargetRequired');
    case 'LOOKDEV_STYLE_DIALOGUE_TRUNCATED':
      return t('createBatch.errorStyleSessionTruncated');
    case 'LOOKDEV_STYLE_JSON_EMPTY':
    case 'LOOKDEV_STYLE_JSON_OBJECT_REQUIRED':
    case 'LOOKDEV_STYLE_DIALOGUE_REPLY_REQUIRED':
    case 'LOOKDEV_STYLE_DIALOGUE_SUMMARY_REQUIRED':
      return t('createBatch.errorStyleSessionResponseInvalid');
    case 'LOOKDEV_STYLE_SYNTHESIS_INPUT_REQUIRED':
      return t('createBatch.errorStyleSessionInputRequired');
    case 'LOOKDEV_STYLE_SYNTHESIS_CONTRACT_INVALID':
      return t('createBatch.errorStylePackSynthesisInvalid');
    default:
      return message;
  }
}

export default function CreateBatchPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const createBatch = useLookdevStore((state) => state.createBatch);
  const storedWorldStyleSessions = useLookdevStore((state) => state.worldStyleSessions);
  const storedWorldStylePacks = useLookdevStore((state) => state.worldStylePacks);
  const storedPortraitBriefs = useLookdevStore((state) => state.portraitBriefs);
  const saveWorldStyleSession = useLookdevStore((state) => state.saveWorldStyleSession);
  const saveWorldStylePack = useLookdevStore((state) => state.saveWorldStylePack);
  const savePortraitBrief = useLookdevStore((state) => state.savePortraitBrief);
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
  const [generationTargetKey, setGenerationTargetKey] = useState('');
  const [evaluationTargetKey, setEvaluationTargetKey] = useState('');
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
  const resolvedWorldId = selectionSource === 'by_world' ? worldId : (selectedWorldIds[0] || '');
  const resolvedWorldName = useMemo(
    () => worldsQuery.data?.find((world) => world.id === resolvedWorldId)?.name || t('createBatch.selectWorld'),
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
    () => textTargets.find((target) => target.key === runtimeProbe.textDefaultTargetKey) || textTargets[0] || null,
    [runtimeProbe.textDefaultTargetKey, textTargets],
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
    const firstAgentId = captureSelectionAgentIds[0] || null;
    if (!firstAgentId) {
      setSelectedBriefAgentId(null);
      return;
    }
    if (!selectedBriefAgentId || !captureSelectionAgentIds.includes(selectedBriefAgentId)) {
      setSelectedBriefAgentId(firstAgentId);
    }
  }, [captureSelectionAgentIds, selectedBriefAgentId]);

  const portraitBriefs = useMemo(
    () => !stylePackConfirmed || !worldStylePack
      ? []
      : selectedAgents.map((agent) => {
        const key = portraitBriefKey(agent.worldId, agent.id);
        return storedPortraitBriefs[key] || compilePortraitBrief({
          agentId: agent.id,
          displayName: agent.displayName,
          worldId: agent.worldId,
          concept: agent.concept,
          description: null,
          worldStylePack,
        });
      }),
    [selectedAgents, storedPortraitBriefs, stylePackConfirmed, worldStylePack],
  );

  const capturePortraitBriefs = useMemo(
    () => portraitBriefs.filter((brief) => captureSelectionAgentIds.includes(brief.agentId)),
    [captureSelectionAgentIds, portraitBriefs],
  );

  const activePortraitBrief = useMemo(
    () => capturePortraitBriefs.find((brief) => brief.agentId === selectedBriefAgentId) || capturePortraitBriefs[0] || null,
    [capturePortraitBriefs, selectedBriefAgentId],
  );
  const activePortraitBriefFieldPrefix = activePortraitBrief ? `lookdev-brief-${activePortraitBrief.agentId}` : 'lookdev-brief';

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

  function updatePortraitBrief(patch: Partial<LookdevPortraitBrief>) {
    if (!activePortraitBrief) {
      return;
    }
    savePortraitBrief({
      ...activePortraitBrief,
      ...patch,
    });
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
            <input
              id="lookdev-batch-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('createBatch.batchNamePlaceholder')}
              className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setSelectionSource('by_world')}
              className={`rounded-3xl border px-4 py-4 text-left ${selectionSource === 'by_world' ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/10 bg-black/12 text-white/72'}`}
            >
              <div className="text-sm font-medium">{t('createBatch.selectionByWorldTitle')}</div>
              <div className="mt-1 text-xs leading-5 text-white/56">{t('createBatch.selectionByWorldDescription')}</div>
            </button>
            <button
              type="button"
              onClick={() => setSelectionSource('explicit_selection')}
              className={`rounded-3xl border px-4 py-4 text-left ${selectionSource === 'explicit_selection' ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/10 bg-black/12 text-white/72'}`}
            >
              <div className="text-sm font-medium">{t('createBatch.selectionExplicitTitle')}</div>
              <div className="mt-1 text-xs leading-5 text-white/56">{t('createBatch.selectionExplicitDescription')}</div>
            </button>
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
              <select
                id="lookdev-world-select"
                value={worldId}
                onChange={(event) => setWorldId(event.target.value)}
                className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
              >
                <option value="">{t('createBatch.selectWorld')}</option>
                {(worldsQuery.data || []).map((world) => (
                  <option key={world.id} value={world.id}>{formatWorldOptionLabel(world.name, world.agentCount)}</option>
                ))}
              </select>
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
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => toggleExplicitSelection(agent.id)}
                      className={`flex w-full items-start justify-between rounded-2xl border px-4 py-3 text-left ${selected ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/8 bg-black/12 text-white/72'}`}
                    >
                      <div>
                        <div className="font-medium text-white">{agent.displayName}</div>
                        <div className="mt-1 text-xs text-white/52">{agent.handle || agent.id} · {agent.worldId} · {t(`importance.${agent.importance}`, { defaultValue: agent.importance })}</div>
                        {agent.concept ? <div className="mt-2 text-xs leading-5 text-white/58">{agent.concept}</div> : null}
                      </div>
                      <span className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">{selected ? t('createBatch.inBatchLabel') : t('createBatch.selectLabel')}</span>
                    </button>
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

          {resolvedWorldId ? (
            <WorldStyleSessionPanel
              worldName={resolvedWorldName}
              styleSession={styleSession}
              styleSessionInput={styleSessionInput}
              worldStylePack={worldStylePack}
              stylePackConfirmed={stylePackConfirmed}
              styleSessionCanSynthesize={styleSessionCanSynthesize}
              styleSessionBusy={styleSessionBusy}
              styleSessionError={styleSessionError}
              styleSessionTargetLabel={describeWorldStyleTarget(currentLanguage, styleDialogueTarget)}
              styleSessionTargetReady={Boolean(styleDialogueTarget)}
              showAdvancedStyleEditor={showAdvancedStyleEditor}
              onStyleSessionInputChange={setStyleSessionInput}
              onStyleSessionReply={() => void handleStyleSessionReply()}
              onRestartStyleSession={handleRestartStyleSession}
              onSynthesizeStylePack={() => void handleSynthesizeStylePack()}
              onConfirmWorldStylePack={handleConfirmWorldStylePack}
              onToggleAdvancedStyleEditor={() => setShowAdvancedStyleEditor((current) => !current)}
              onUpdateWorldStylePack={updateWorldStylePack}
            />
          ) : null}

          <CaptureSelectionPanel
            stylePackConfirmed={stylePackConfirmed}
            selectedAgents={selectedAgents}
            captureSelectionAgentIds={captureSelectionAgentIds}
            onToggleCaptureSelection={toggleCaptureSelection}
          />

          <EmbeddedCapturePanel
            stylePackConfirmed={stylePackConfirmed}
            capturePortraitBriefs={capturePortraitBriefs}
            activePortraitBrief={activePortraitBrief}
            activePortraitBriefFieldPrefix={activePortraitBriefFieldPrefix}
            onSelectBriefAgent={setSelectedBriefAgentId}
            onUpdatePortraitBrief={updatePortraitBrief}
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
        disabled={saving || intakeLoading || Boolean(intakeError) || !stylePackConfirmed || worldSelectionUnavailable || !generationTarget || !evaluationTarget}
        onGenerationTargetChange={setGenerationTargetKey}
        onEvaluationTargetChange={setEvaluationTargetKey}
        onScoreThresholdChange={setScoreThreshold}
        onMaxConcurrencyChange={setMaxConcurrency}
        onCreate={() => void handleCreate()}
      />
    </div>
  );
}
