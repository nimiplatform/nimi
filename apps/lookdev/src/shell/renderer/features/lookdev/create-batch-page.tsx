import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listLookdevAgents, listLookdevWorlds } from '@renderer/data/lookdev-data-client.js';
import { useLookdevStore } from './lookdev-store.js';
import type { LookdevSelectionSource } from './types.js';

export default function CreateBatchPage() {
  const navigate = useNavigate();
  const createBatch = useLookdevStore((state) => state.createBatch);
  const [selectionSource, setSelectionSource] = useState<LookdevSelectionSource>('by_world');
  const [worldId, setWorldId] = useState('');
  const [name, setName] = useState('');
  const [scoreThreshold, setScoreThreshold] = useState('78');
  const [maxConcurrency, setMaxConcurrency] = useState('1');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
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

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const selectedAgents = selectionSource === 'by_world'
        ? worldAgents
        : selectableAgents.filter((agent) => selectedAgentIds.includes(agent.id));
      if (selectedAgents.length === 0) {
        throw new Error('Select at least one world-backed agent.');
      }
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
        worldId: selectionSource === 'by_world' ? worldId : undefined,
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
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="ld-card px-7 py-7">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--ld-gold)]">Create Batch</div>
          <h2 className="text-3xl font-semibold text-white">Freeze one policy, then let the control plane run.</h2>
        </div>

        <div className="mt-8 grid gap-6">
          <div className="grid gap-2">
            <label htmlFor="lookdev-batch-name" className="text-sm text-white/74">Batch name</label>
            <input
              id="lookdev-batch-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Spring cast portrait refresh"
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
              <div className="mt-1 text-xs leading-5 text-white/56">Freeze all current agents from one world into the batch snapshot.</div>
            </button>
            <button
              type="button"
              onClick={() => setSelectionSource('explicit_selection')}
              className={`rounded-3xl border px-4 py-4 text-left ${selectionSource === 'explicit_selection' ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/10 bg-black/12 text-white/72'}`}
            >
              <div className="text-sm font-medium">Explicit agent selection</div>
              <div className="mt-1 text-xs leading-5 text-white/56">Manually freeze a cross-world set of world-backed agents.</div>
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
                  Frozen selection preview: {worldAgents.length} world-backed agents from this world will enter the batch.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3">
              <label className="text-sm text-white/74">Agents</label>
              <div className="max-h-[360px] space-y-2 overflow-auto pr-1 ld-scroll">
                {selectableAgents.map((agent) => {
                  const selected = selectedAgentIds.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setSelectedAgentIds((current) => selected ? current.filter((id) => id !== agent.id) : [...current, agent.id])}
                      className={`flex w-full items-start justify-between rounded-2xl border px-4 py-3 text-left ${selected ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/8 bg-black/12 text-white/72'}`}
                    >
                      <div>
                        <div className="font-medium text-white">{agent.displayName}</div>
                        <div className="mt-1 text-xs text-white/52">{agent.handle || agent.id} · {agent.worldId}</div>
                        {agent.concept ? <div className="mt-2 text-xs leading-5 text-white/58">{agent.concept}</div> : null}
                      </div>
                      <span className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">{selected ? 'In batch' : 'Select'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="ld-card px-7 py-7">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--ld-gold)]">Policy Snapshot</div>
          <h3 className="text-2xl font-semibold text-white">Shared policy for every item in the batch.</h3>
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
            <div>Generation discipline: one current result per item, full-body anchor framing, subdued background.</div>
            <div>Retry discipline: batch-owned correction hints only, no per-item prompt editing.</div>
            <div>Writeback discipline: commit only passed and not-yet-committed items to Realm `AGENT_PORTRAIT`.</div>
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
