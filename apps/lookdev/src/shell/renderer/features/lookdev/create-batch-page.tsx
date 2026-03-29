import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listLookdevAgents, listLookdevWorlds } from '@renderer/data/lookdev-data-client.js';
import { useLookdevStore } from './lookdev-store.js';
import { compilePortraitBrief } from './prompting.js';
import { createDefaultWorldStylePack, type LookdevPortraitBrief, type LookdevSelectionSource, type LookdevWorldStylePack } from './types.js';

function portraitBriefKey(worldId: string | null | undefined, agentId: string): string {
  return `${String(worldId || 'unscoped').trim() || 'unscoped'}::${agentId}`;
}

export default function CreateBatchPage() {
  const navigate = useNavigate();
  const createBatch = useLookdevStore((state) => state.createBatch);
  const storedWorldStylePacks = useLookdevStore((state) => state.worldStylePacks);
  const storedPortraitBriefs = useLookdevStore((state) => state.portraitBriefs);
  const saveWorldStylePack = useLookdevStore((state) => state.saveWorldStylePack);
  const savePortraitBrief = useLookdevStore((state) => state.savePortraitBrief);
  const [selectionSource, setSelectionSource] = useState<LookdevSelectionSource>('by_world');
  const [worldId, setWorldId] = useState('');
  const [name, setName] = useState('');
  const [scoreThreshold, setScoreThreshold] = useState('78');
  const [maxConcurrency, setMaxConcurrency] = useState('1');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [captureSelectionAgentIds, setCaptureSelectionAgentIds] = useState<string[]>([]);
  const [worldStylePack, setWorldStylePack] = useState<LookdevWorldStylePack | null>(null);
  const [selectedBriefAgentId, setSelectedBriefAgentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const worldsQuery = useQuery({
    queryKey: ['lookdev', 'worlds'],
    queryFn: listLookdevWorlds,
  });

  const agentsQuery = useQuery({
    queryKey: ['lookdev', 'agents'],
    queryFn: listLookdevAgents,
  });

  const selectableAgents = useMemo(
    () => (agentsQuery.data || []).filter((agent) => agent.worldId),
    [agentsQuery.data],
  );

  const worldAgents = useMemo(
    () => selectableAgents.filter((agent) => agent.worldId === worldId),
    [selectableAgents, worldId],
  );

  const explicitSelectedAgents = useMemo(
    () => selectableAgents.filter((agent) => selectedAgentIds.includes(agent.id)),
    [selectableAgents, selectedAgentIds],
  );

  const selectedAgents = selectionSource === 'by_world' ? worldAgents : explicitSelectedAgents;
  const selectedWorldIds = [...new Set(selectedAgents.map((agent) => agent.worldId).filter(Boolean))];
  const resolvedWorldId = selectionSource === 'by_world' ? worldId : (selectedWorldIds[0] || '');
  const resolvedWorldName = useMemo(
    () => worldsQuery.data?.find((world) => world.id === resolvedWorldId)?.name || 'Selected world',
    [resolvedWorldId, worldsQuery.data],
  );

  useEffect(() => {
    if (!resolvedWorldId) {
      setWorldStylePack(null);
      return;
    }
    const storedPack = storedWorldStylePacks[resolvedWorldId];
    setWorldStylePack((current) => {
      if (current && current.worldId === resolvedWorldId) {
        return current;
      }
      return storedPack || createDefaultWorldStylePack(resolvedWorldId, resolvedWorldName);
    });
  }, [resolvedWorldId, resolvedWorldName, storedWorldStylePacks]);

  useEffect(() => {
    const defaultCaptureIds = selectedAgents
      .filter((agent) => agent.importance === 'PRIMARY')
      .map((agent) => agent.id);
    const selectedAgentIdSet = new Set(selectedAgents.map((agent) => agent.id));
    setCaptureSelectionAgentIds((current) => {
      const retained = current.filter((agentId) => selectedAgentIdSet.has(agentId));
      const next = [...new Set([...retained, ...defaultCaptureIds])];
      return next;
    });
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
    () => selectedAgents.map((agent) => {
      const key = portraitBriefKey(agent.worldId, agent.id);
      return storedPortraitBriefs[key] || compilePortraitBrief({
        agentId: agent.id,
        displayName: agent.displayName,
        worldId: agent.worldId,
        concept: agent.concept,
        description: null,
        worldStylePack: worldStylePack || createDefaultWorldStylePack(resolvedWorldId || agent.worldId || agent.id, resolvedWorldName),
      });
    }),
    [resolvedWorldId, resolvedWorldName, selectedAgents, storedPortraitBriefs, worldStylePack],
  );

  const capturePortraitBriefs = useMemo(
    () => portraitBriefs.filter((brief) => captureSelectionAgentIds.includes(brief.agentId)),
    [captureSelectionAgentIds, portraitBriefs],
  );

  const activePortraitBrief = useMemo(
    () => capturePortraitBriefs.find((brief) => brief.agentId === selectedBriefAgentId) || capturePortraitBriefs[0] || null,
    [capturePortraitBriefs, selectedBriefAgentId],
  );

  function updateWorldStylePack(patch: Partial<LookdevWorldStylePack>) {
    setWorldStylePack((current) => {
      if (!current) {
        return current;
      }
      const next = {
        ...current,
        ...patch,
      };
      saveWorldStylePack(next);
      return next;
    });
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
      if (selectedAgents.length === 0) {
        throw new Error('Select at least one world-backed agent.');
      }
      if (selectedWorldIds.length > 1) {
        throw new Error('One batch can only target one world style lane. Narrow the selection to one world.');
      }
      if (!resolvedWorldId || !worldStylePack) {
        throw new Error('Select one world before creating a batch.');
      }
      saveWorldStylePack(worldStylePack);
      portraitBriefs.forEach((brief) => savePortraitBrief(brief));
      const batchId = await createBatch({
        name,
        selectionSource,
        agents: selectedAgents.map((agent) => ({
          ...agent,
          description: null,
          scenario: null,
          greeting: null,
          currentPortrait: null,
        })),
        worldId: resolvedWorldId,
        worldStylePack: worldStylePack,
        captureSelectionAgentIds,
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
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--ld-gold)]">Create Batch</div>
          <h2 className="text-3xl font-semibold text-white">Define one world style lane, then freeze one batch.</h2>
        </div>

        <div className="mt-8 grid gap-6">
          <div className="grid gap-2">
            <label htmlFor="lookdev-batch-name" className="text-sm text-white/74">Batch name</label>
            <input
              id="lookdev-batch-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="World cast portrait standardization"
              className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setSelectionSource('by_world')}
              className={`rounded-3xl border px-4 py-4 text-left ${selectionSource === 'by_world' ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/10 bg-black/12 text-white/72'}`}
            >
              <div className="text-sm font-medium">World-scoped selection</div>
              <div className="mt-1 text-xs leading-5 text-white/56">Use one world as the batch lane and inherit one shared style pack.</div>
            </button>
            <button
              type="button"
              onClick={() => setSelectionSource('explicit_selection')}
              className={`rounded-3xl border px-4 py-4 text-left ${selectionSource === 'explicit_selection' ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/10 bg-black/12 text-white/72'}`}
            >
              <div className="text-sm font-medium">Explicit agent selection</div>
              <div className="mt-1 text-xs leading-5 text-white/56">Manually choose agents, but the final batch must still resolve to one world.</div>
            </button>
          </div>

          {selectionSource === 'by_world' ? (
            <div className="grid gap-2">
              <label htmlFor="lookdev-world-select" className="text-sm text-white/74">World</label>
              <select
                id="lookdev-world-select"
                value={worldId}
                onChange={(event) => setWorldId(event.target.value)}
                className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
              >
                <option value="">Select world</option>
                {(worldsQuery.data || []).map((world) => (
                  <option key={world.id} value={world.id}>{world.name} · {world.agentCount} agents</option>
                ))}
              </select>
              {worldId ? (
                <div className="rounded-2xl border border-white/8 bg-black/14 px-4 py-3 text-sm text-white/66">
                  Frozen selection preview: {worldAgents.length} agents from {resolvedWorldName}.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3">
              <label className="text-sm text-white/74">Agents</label>
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
                        <div className="mt-1 text-xs text-white/52">{agent.handle || agent.id} · {agent.worldId} · {agent.importance}</div>
                        {agent.concept ? <div className="mt-2 text-xs leading-5 text-white/58">{agent.concept}</div> : null}
                      </div>
                      <span className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">{selected ? 'In batch' : 'Select'}</span>
                    </button>
                  );
                })}
              </div>
              {selectedWorldIds.length > 1 ? (
                <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                  Selected agents currently span multiple worlds. Narrow to one world before creating a batch.
                </div>
              ) : null}
            </div>
          )}

          {worldStylePack ? (
            <div className="grid gap-4 rounded-3xl border border-white/8 bg-black/14 px-5 py-5">
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">World Style Pack</div>
                <div className="text-sm text-white/62">Reusable working state for {resolvedWorldName}. This stays in Lookdev and does not become Realm truth.</div>
              </div>

              <div className="grid gap-2">
                <label className="text-sm text-white/74">Style pack name</label>
                <input
                  value={worldStylePack.name}
                  onChange={(event) => updateWorldStylePack({ name: event.target.value })}
                  className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-sm text-white/74">Visual era</label>
                  <input
                    value={worldStylePack.visualEra}
                    onChange={(event) => updateWorldStylePack({ visualEra: event.target.value })}
                    className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm text-white/74">Art style</label>
                  <input
                    value={worldStylePack.artStyle}
                    onChange={(event) => updateWorldStylePack({ artStyle: event.target.value })}
                    className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm text-white/74">Palette direction</label>
                  <input
                    value={worldStylePack.paletteDirection}
                    onChange={(event) => updateWorldStylePack({ paletteDirection: event.target.value })}
                    className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm text-white/74">Silhouette direction</label>
                  <input
                    value={worldStylePack.silhouetteDirection}
                    onChange={(event) => updateWorldStylePack({ silhouetteDirection: event.target.value })}
                    className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 rounded-3xl border border-white/8 bg-black/14 px-5 py-5">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">Capture Selection</div>
              <div className="text-sm text-white/62">Default = primary agents. User is the authority.</div>
            </div>
            <div className="max-h-[280px] space-y-2 overflow-auto pr-1 ld-scroll">
              {selectedAgents.map((agent) => {
                const selected = captureSelectionAgentIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => toggleCaptureSelection(agent.id)}
                    className={`flex w-full items-start justify-between rounded-2xl border px-4 py-3 text-left ${selected ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/8 bg-black/12 text-white/72'}`}
                  >
                    <div>
                      <div className="font-medium text-white">{agent.displayName}</div>
                      <div className="mt-1 text-xs text-white/52">{agent.importance} · {agent.handle || agent.id}</div>
                    </div>
                    <span className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">{selected ? 'Capture' : 'Batch only'}</span>
                  </button>
                );
              })}
              {selectedAgents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/40">
                  Select agents first to configure capture selection.
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 rounded-3xl border border-white/8 bg-black/14 px-5 py-5">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">Embedded Capture</div>
              <div className="text-sm text-white/62">After capture selection is set, selected capture agents get an in-place brief refinement step inside Lookdev. Edits are saved in Lookdev and reused across later batches.</div>
            </div>
            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="max-h-[280px] space-y-2 overflow-auto pr-1 ld-scroll">
                {capturePortraitBriefs.map((brief) => {
                  const selected = brief.agentId === activePortraitBrief?.agentId;
                  return (
                    <button
                      key={brief.agentId}
                      type="button"
                      onClick={() => setSelectedBriefAgentId(brief.agentId)}
                      className={`flex w-full items-start justify-between rounded-2xl border px-4 py-3 text-left ${selected ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/8 bg-black/12 text-white/72'}`}
                    >
                      <div>
                        <div className="font-medium text-white">{brief.displayName}</div>
                        <div className="mt-1 text-xs text-white/52">{brief.visualRole}</div>
                      </div>
                      <span className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">{selected ? 'Editing' : 'Review'}</span>
                    </button>
                  );
                })}
                {capturePortraitBriefs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/40">
                    No capture agents selected. Keep everything in batch-only mode, or select agents above to open embedded capture refinement.
                  </div>
                ) : null}
              </div>

              {activePortraitBrief ? (
                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <label className="text-sm text-white/74">Visual role</label>
                    <input
                      value={activePortraitBrief.visualRole}
                      onChange={(event) => updatePortraitBrief({ visualRole: event.target.value })}
                      className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm text-white/74">Silhouette</label>
                    <input
                      value={activePortraitBrief.silhouette}
                      onChange={(event) => updatePortraitBrief({ silhouette: event.target.value })}
                      className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm text-white/74">Outfit</label>
                    <input
                      value={activePortraitBrief.outfit}
                      onChange={(event) => updatePortraitBrief({ outfit: event.target.value })}
                      className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="grid gap-2">
                      <label className="text-sm text-white/74">Hairstyle</label>
                      <input
                        value={activePortraitBrief.hairstyle}
                        onChange={(event) => updatePortraitBrief({ hairstyle: event.target.value })}
                        className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm text-white/74">Palette</label>
                      <input
                        value={activePortraitBrief.palettePrimary}
                        onChange={(event) => updatePortraitBrief({ palettePrimary: event.target.value })}
                        className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm text-white/74">Must keep traits</label>
                    <input
                      value={activePortraitBrief.mustKeepTraits.join(', ')}
                      onChange={(event) => updatePortraitBrief({
                        mustKeepTraits: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                      })}
                      className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm text-white/74">Forbidden traits</label>
                    <input
                      value={activePortraitBrief.forbiddenTraits.join(', ')}
                      onChange={(event) => updatePortraitBrief({
                        forbiddenTraits: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                      })}
                      className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="ld-card px-7 py-7">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--ld-gold)]">Policy Snapshot</div>
          <h3 className="text-2xl font-semibold text-white">Shared batch policy after style and capture settle.</h3>
        </div>

        <div className="mt-8 grid gap-5">
          <div className="grid gap-2">
            <label htmlFor="lookdev-score-threshold" className="text-sm text-white/74">Auto-eval score threshold</label>
            <input
              id="lookdev-score-threshold"
              value={scoreThreshold}
              onChange={(event) => setScoreThreshold(event.target.value)}
              type="number"
              min="1"
              max="100"
              className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="lookdev-max-concurrency" className="text-sm text-white/74">Max concurrency</label>
            <input
              id="lookdev-max-concurrency"
              value={maxConcurrency}
              onChange={(event) => setMaxConcurrency(event.target.value)}
              type="number"
              min="1"
              max="4"
              className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
            />
          </div>

          <div className="rounded-3xl border border-white/8 bg-black/14 px-5 py-5 text-sm leading-7 text-white/64">
            <div>Style pack and portrait briefs are Lookdev-local working state and can be reused across batches.</div>
            <div>Capture selection is user-owned and defaults to primary agents.</div>
            <div>Writeback still commits only passed and not-yet-committed items to Realm `AGENT_PORTRAIT`.</div>
          </div>

          {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving || worldsQuery.isLoading || agentsQuery.isLoading}
            className="rounded-2xl bg-[var(--ld-accent)] px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-[var(--ld-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Creating batch…' : 'Create and start processing'}
          </button>
        </div>
      </section>
    </div>
  );
}
