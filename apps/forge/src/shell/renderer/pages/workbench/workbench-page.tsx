import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ForgeWorkspacePanel } from '@renderer/features/workbench/types.js';
import { useAgentListQuery } from '@renderer/hooks/use-agent-queries.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import { WorldCreatePageView } from '@renderer/pages/worlds/world-create-page.js';
import { WorldMaintainPageView } from '@renderer/pages/worlds/world-maintain-page.js';
import { publishForgeWorkspacePlan, type PublishProgress } from '@renderer/features/import/data/import-publish-client.js';
import { useImageGeneration } from '@renderer/hooks/use-image-generation.js';
import type { ImageGenEntityContext } from '@renderer/data/image-gen-client.js';

type WorkbenchPanel = ForgeWorkspacePanel;

const PANELS: WorkbenchPanel[] = [
  'OVERVIEW',
  'WORLD_TRUTH',
  'IMPORT',
  'REVIEW',
  'AGENTS',
  'PUBLISH',
];

function formatDate(iso: string): string {
  if (!iso) {
    return '';
  }
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function WorkbenchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPanel = (searchParams.get('panel') || 'OVERVIEW').toUpperCase() as WorkbenchPanel;
  const panel = PANELS.includes(requestedPanel) ? requestedPanel : 'OVERVIEW';

  const snapshot = useForgeWorkspaceStore((state) => state.workspaces[workspaceId]);
  const setActiveWorkspace = useForgeWorkspaceStore((state) => state.setActiveWorkspace);
  const setWorkspacePanel = useForgeWorkspaceStore((state) => state.setWorkspacePanel);
  const patchWorldDraft = useForgeWorkspaceStore((state) => state.patchWorldDraft);
  const updateReviewWorldRule = useForgeWorkspaceStore((state) => state.updateReviewWorldRule);
  const updateReviewAgentRule = useForgeWorkspaceStore((state) => state.updateReviewAgentRule);
  const updateAgentDraft = useForgeWorkspaceStore((state) => state.updateAgentDraft);
  const attachMasterAgentClone = useForgeWorkspaceStore((state) => state.attachMasterAgentClone);
  const buildPublishPlan = useForgeWorkspaceStore((state) => state.buildPublishPlan);
  const markPublished = useForgeWorkspaceStore((state) => state.markPublished);

  const masterAgentsQuery = useAgentListQuery(true);
  const masterAgents = useMemo(
    () => (masterAgentsQuery.data || []).filter((agent) => agent.ownershipType === 'MASTER_OWNED'),
    [masterAgentsQuery.data],
  );

  const [publishProgress, setPublishProgress] = useState<PublishProgress | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const imageGen = useImageGeneration();
  const [visualPrompt, setVisualPrompt] = useState('');

  const VISUAL_PHASE_LABELS: Record<string, string> = {
    composing_prompt: 'Composing prompt...',
    generating: 'Generating...',
    uploading: 'Uploading...',
    binding: 'Binding...',
  };

  function buildWorldImageContext(target: 'world-banner' | 'world-icon'): ImageGenEntityContext {
    return {
      target,
      worldName: snapshot?.worldDraft.name || snapshot?.workspace.title || '',
      worldDescription: snapshot?.worldDraft.description || '',
      userPrompt: visualPrompt.trim() || undefined,
    };
  }

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-neutral-400">Workspace not found.</p>
          <button
            onClick={() => navigate('/workbench')}
            className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
          >
            Back to Workbench
          </button>
        </div>
      </div>
    );
  }

  useEffect(() => {
    setActiveWorkspace(workspaceId);
  }, [setActiveWorkspace, workspaceId]);

  useEffect(() => {
    if (snapshot.workspace.activePanel !== panel) {
      setWorkspacePanel(workspaceId, panel);
    }
  }, [panel, setWorkspacePanel, snapshot.workspace.activePanel, workspaceId]);

  const openPanel = (nextPanel: WorkbenchPanel) => {
    setWorkspacePanel(workspaceId, nextPanel);
    setSearchParams({ panel: nextPanel });
  };

  const reviewReady = !snapshot.reviewState.hasPendingConflicts
    && !snapshot.reviewState.hasUnmappedCharacters
    && (
      snapshot.reviewState.agentBundles.length > 0
      || snapshot.reviewState.worldRules.length > 0
      || Boolean(snapshot.worldDraft.worldId)
    );

  const handlePublish = async () => {
    setPublishError(null);
    const plan = buildPublishPlan(workspaceId);
    if (!plan) {
      setPublishError('Unable to build publish plan.');
      return;
    }
    try {
      const result = await publishForgeWorkspacePlan({
        plan,
        worldName: snapshot.worldDraft.name || snapshot.workspace.title,
        worldDescription: snapshot.worldDraft.description,
        targetWorldId: snapshot.worldDraft.worldId,
        agentBundles: snapshot.reviewState.agentBundles,
        onProgress: setPublishProgress,
      });
      if (result.errors.length > 0) {
        setPublishError(result.errors[0]?.message || 'Publish completed with errors.');
      }
      markPublished(workspaceId, {
        worldId: result.worldId,
        draftAgentIdMap: result.draftAgentIds,
      });
      openPanel('OVERVIEW');
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="w-72 shrink-0 border-r border-neutral-800 bg-neutral-950/90 px-4 py-5">
        <button
          onClick={() => navigate('/workbench')}
          className="text-xs uppercase tracking-[0.18em] text-neutral-500 transition-colors hover:text-neutral-300"
        >
          Workbench
        </button>
        <div className="mt-4">
          <h1 className="text-xl font-semibold text-white">{snapshot.workspace.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {snapshot.worldDraft.worldId ? `World ${snapshot.worldDraft.worldId.slice(0, 8)}` : 'Local draft workspace'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-neutral-800 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-neutral-300">
              {snapshot.workspace.lifecycle}
            </span>
            <span className="rounded-full bg-sky-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-sky-300">
              {snapshot.reviewState.worldRules.length} world rules
            </span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-emerald-300">
              {snapshot.reviewState.agentBundles.length} agents
            </span>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          {PANELS.map((item) => (
            <button
              key={item}
              onClick={() => openPanel(item)}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                panel === item
                  ? 'bg-white text-black'
                  : 'text-neutral-400 hover:bg-neutral-900 hover:text-white'
              }`}
            >
              {item.replaceAll('_', ' ')}
            </button>
          ))}
        </nav>

        <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">Local Status</p>
          <div className="mt-3 space-y-2 text-sm text-neutral-400">
            <p>{snapshot.importSessions.length} import session(s)</p>
            <p>{snapshot.reviewState.conflicts.length} conflict record(s)</p>
            <p>Updated {formatDate(snapshot.updatedAt)}</p>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto bg-neutral-950">
        {panel === 'OVERVIEW' ? (
          <section className="mx-auto max-w-6xl p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
                <h2 className="text-lg font-semibold text-white">Workspace Overview</h2>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.14em] text-neutral-500">World Name</span>
                    <input
                      value={snapshot.worldDraft.name}
                      onChange={(event) => patchWorldDraft(workspaceId, { name: event.target.value })}
                      className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.14em] text-neutral-500">Source Type</span>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
                      {snapshot.worldDraft.sourceType}
                    </div>
                  </label>
                </div>
                <label className="mt-4 block space-y-2">
                  <span className="text-xs uppercase tracking-[0.14em] text-neutral-500">Description</span>
                  <textarea
                    rows={4}
                    value={snapshot.worldDraft.description}
                    onChange={(event) => patchWorldDraft(workspaceId, { description: event.target.value })}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
                  />
                </label>

                <div className="mt-6 grid gap-3 md:grid-cols-4">
                  {[
                    { label: 'World Rules', value: snapshot.reviewState.worldRules.length },
                    { label: 'Agent Bundles', value: snapshot.reviewState.agentBundles.length },
                    { label: 'Import Sessions', value: snapshot.importSessions.length },
                    { label: 'Conflicts', value: snapshot.reviewState.conflicts.length },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                      <p className="text-xs text-neutral-500">{stat.label}</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
                <h2 className="text-lg font-semibold text-white">Next Action</h2>
                <div className="mt-5 space-y-3">
                  <button
                    onClick={() => openPanel('WORLD_TRUTH')}
                    className="w-full rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-left text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
                  >
                    Continue World Truth
                  </button>
                  <button
                    onClick={() => navigate(`/workbench/${workspaceId}/import/character-card`)}
                    className="w-full rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-left text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
                  >
                    Import Character Card
                  </button>
                  <button
                    onClick={() => navigate(`/workbench/${workspaceId}/import/novel`)}
                    className="w-full rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-left text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
                  >
                    Import Novel
                  </button>
                  <button
                    onClick={() => openPanel('REVIEW')}
                    className="w-full rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-left text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
                  >
                    Review Truth Draft
                  </button>
                </div>
              </div>
            </div>

            {/* World Visuals */}
            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">World Visuals</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => void imageGen.generate(buildWorldImageContext('world-banner'))}
                    disabled={imageGen.busy}
                    className="rounded-xl bg-white px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
                  >
                    {imageGen.busy ? (VISUAL_PHASE_LABELS[imageGen.phase] || imageGen.phase) : 'Generate Banner'}
                  </button>
                  <button
                    onClick={() => void imageGen.generate(buildWorldImageContext('world-icon'))}
                    disabled={imageGen.busy}
                    className="rounded-xl border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
                  >
                    Generate Icon
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <input
                  type="text"
                  value={visualPrompt}
                  onChange={(e) => setVisualPrompt(e.target.value)}
                  placeholder="Additional prompt instructions (optional)..."
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
                />
              </div>

              {imageGen.error ? (
                <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2">
                  <p className="text-xs text-red-400">{imageGen.error}</p>
                  <button onClick={imageGen.clearError} className="mt-1 text-xs text-red-300 underline">
                    Dismiss
                  </button>
                </div>
              ) : null}

              {imageGen.candidates.length > 0 ? (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {imageGen.candidates.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="group relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950"
                    >
                      <img src={candidate.url} alt="" className="aspect-video w-full object-cover" />
                      <div className="absolute inset-0 flex items-end bg-black/60 p-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <div className="flex w-full gap-1.5">
                          {snapshot.worldDraft.worldId ? (
                            <>
                              <button
                                onClick={() => void imageGen.useAsWorldBanner(snapshot.worldDraft.worldId!, candidate)}
                                disabled={imageGen.busy}
                                className="flex-1 rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-black disabled:opacity-50"
                              >
                                Set as Banner
                              </button>
                              <button
                                onClick={() => void imageGen.useAsWorldIcon(snapshot.worldDraft.worldId!, candidate)}
                                disabled={imageGen.busy}
                                className="flex-1 rounded-lg bg-neutral-700 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                              >
                                Set as Icon
                              </button>
                            </>
                          ) : null}
                          <button
                            onClick={() => void imageGen.saveToLibrary(candidate)}
                            disabled={imageGen.busy}
                            className="rounded-lg bg-neutral-800 px-2 py-1 text-[11px] font-medium text-neutral-300 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => imageGen.removeCandidate(candidate.id)}
                            className="rounded-lg bg-neutral-900 px-2 py-1 text-[11px] font-medium text-neutral-500"
                          >
                            &times;
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {!snapshot.worldDraft.worldId && imageGen.candidates.length > 0 ? (
                <p className="mt-2 text-xs text-neutral-500">
                  Publish the world first to bind images as banner or icon.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {panel === 'WORLD_TRUTH' ? (
          snapshot.worldDraft.worldId ? (
            <WorldMaintainPageView
              embedded
              worldIdOverride={snapshot.worldDraft.worldId}
              title={snapshot.workspace.title}
            />
          ) : (
            <WorldCreatePageView
              embedded
              resumeDraftId={snapshot.worldDraft.draftId || ''}
              title={snapshot.workspace.title}
            />
          )
        ) : null}

        {panel === 'IMPORT' ? (
          <section className="mx-auto max-w-5xl p-8">
            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
              <h2 className="text-lg font-semibold text-white">Import into Workspace</h2>
              <p className="mt-2 text-sm text-neutral-500">
                Import pipelines no longer publish directly. They write source fidelity and review drafts back into this workspace.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={() => navigate(`/workbench/${workspaceId}/import/character-card`)}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black"
                >
                  Character Card
                </button>
                <button
                  onClick={() => navigate(`/workbench/${workspaceId}/import/novel`)}
                  className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-300"
                >
                  Novel
                </button>
              </div>

              <div className="mt-6 space-y-3">
                {snapshot.importSessions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/70 p-6 text-sm text-neutral-500">
                    No import sessions recorded yet.
                  </div>
                ) : snapshot.importSessions.map((session) => (
                  <div key={session.sessionId} className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-white">{session.sourceFile}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {session.sessionType} · {session.status} · {session.unresolvedConflicts} unresolved conflict(s)
                        </p>
                      </div>
                      <button
                        onClick={() => openPanel('REVIEW')}
                        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300"
                      >
                        Open Review
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {panel === 'REVIEW' ? (
          <section className="mx-auto max-w-6xl p-8">
            <div className="space-y-6">
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Unified Review</h2>
                    <p className="mt-2 text-sm text-neutral-500">
                      Seed rules, import evidence, and world-owned agent drafts all converge here before publish.
                    </p>
                  </div>
                  <button
                    onClick={() => openPanel('PUBLISH')}
                    disabled={!reviewReady}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
                  >
                    Build Publish Plan
                  </button>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <span className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.14em] ${
                    snapshot.reviewState.hasPendingConflicts
                      ? 'bg-red-500/10 text-red-300'
                      : 'bg-emerald-500/10 text-emerald-300'
                  }`}>
                    {snapshot.reviewState.hasPendingConflicts ? 'Conflicts Pending' : 'Conflicts Clear'}
                  </span>
                  <span className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.14em] ${
                    snapshot.reviewState.hasUnmappedCharacters
                      ? 'bg-yellow-500/10 text-yellow-300'
                      : 'bg-sky-500/10 text-sky-300'
                  }`}>
                    {snapshot.reviewState.hasUnmappedCharacters ? 'Character Mapping Needed' : 'Character Mapping Ready'}
                  </span>
                </div>
              </div>

              {snapshot.reviewState.conflicts.length > 0 ? (
                <div className="rounded-3xl border border-red-900/40 bg-red-950/20 p-6">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-red-300">Conflict Diff</h3>
                  <div className="mt-4 space-y-3">
                    {snapshot.reviewState.conflicts.map((conflict) => (
                      <div key={`${conflict.sessionId}:${conflict.ruleKey}`} className="rounded-2xl border border-red-900/40 bg-neutral-950/60 p-4">
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-neutral-500">{conflict.ruleKey}</code>
                          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300">
                            {conflict.resolution}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-3">
                            <p className="text-xs text-neutral-500">Previous</p>
                            <p className="mt-2 text-sm text-neutral-300">{conflict.previousStatement}</p>
                          </div>
                          <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-3">
                            <p className="text-xs text-neutral-500">New</p>
                            <p className="mt-2 text-sm text-neutral-300">{conflict.newStatement}</p>
                          </div>
                        </div>
                        {conflict.mergedStatement ? (
                          <div className="mt-3 rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3">
                            <p className="text-xs text-emerald-300">Merged Preview</p>
                            <p className="mt-2 text-sm text-neutral-300">{conflict.mergedStatement}</p>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-300">World Rules</h3>
                <div className="mt-4 space-y-4">
                  {snapshot.reviewState.worldRules.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/70 p-6 text-sm text-neutral-500">
                      No workspace-scoped world rules yet.
                    </div>
                  ) : snapshot.reviewState.worldRules.map((rule, index) => (
                    <div key={rule.ruleKey} className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-xs text-neutral-500">{rule.ruleKey}</code>
                        <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-sky-300">
                          {rule.domain}
                        </span>
                        <select
                          value={rule.hardness}
                          onChange={(event) => updateReviewWorldRule(workspaceId, index, {
                            hardness: event.target.value as typeof rule.hardness,
                          })}
                          className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white"
                        >
                          <option value="AESTHETIC">AESTHETIC</option>
                          <option value="SOFT">SOFT</option>
                          <option value="FIRM">FIRM</option>
                          <option value="HARD">HARD</option>
                        </select>
                      </div>
                      <input
                        value={rule.title}
                        onChange={(event) => updateReviewWorldRule(workspaceId, index, { title: event.target.value })}
                        className="mt-3 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
                      />
                      <textarea
                        rows={3}
                        value={rule.statement}
                        onChange={(event) => updateReviewWorldRule(workspaceId, index, { statement: event.target.value })}
                        className="mt-3 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-300">Agent Truth</h3>
                <div className="mt-4 space-y-4">
                  {snapshot.reviewState.agentBundles.map((bundle) => {
                    const agentDraft = snapshot.agentDrafts[bundle.draftAgentId];
                    return (
                      <div key={bundle.draftAgentId} className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{agentDraft?.displayName || bundle.characterName}</p>
                            <p className="mt-1 text-xs text-neutral-500">{agentDraft?.handle || 'draft-handle'}</p>
                          </div>
                          <button
                            onClick={() => navigate(`/workbench/${workspaceId}/agents/${bundle.draftAgentId}`)}
                            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300"
                          >
                            Open Agent
                          </button>
                        </div>
                        <div className="mt-4 space-y-3">
                          {bundle.rules.map((rule, index) => (
                            <div key={rule.ruleKey} className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <code className="text-xs text-neutral-500">{rule.ruleKey}</code>
                                <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300">
                                  {rule.layer}
                                </span>
                              </div>
                              <input
                                value={rule.title}
                                onChange={(event) => updateReviewAgentRule(workspaceId, bundle.draftAgentId, index, {
                                  title: event.target.value,
                                })}
                                className="mt-3 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
                              />
                              <textarea
                                rows={3}
                                value={rule.statement}
                                onChange={(event) => updateReviewAgentRule(workspaceId, bundle.draftAgentId, index, {
                                  statement: event.target.value,
                                })}
                                className="mt-3 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {panel === 'AGENTS' ? (
          <section className="mx-auto max-w-6xl p-8">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
                <h2 className="text-lg font-semibold text-white">World-Owned Draft Agents</h2>
                <div className="mt-5 space-y-3">
                  {Object.values(snapshot.agentDrafts).length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/70 p-6 text-sm text-neutral-500">
                      No world-owned draft agents yet.
                    </div>
                  ) : Object.values(snapshot.agentDrafts).map((agentDraft) => (
                    <div key={agentDraft.draftAgentId} className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">{agentDraft.displayName}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            @{agentDraft.handle} · {agentDraft.source} · {agentDraft.status}
                          </p>
                        </div>
                        <button
                          onClick={() => navigate(`/workbench/${workspaceId}/agents/${agentDraft.draftAgentId}`)}
                          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300"
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
                <h2 className="text-lg font-semibold text-white">Master Agent Library</h2>
                <div className="mt-5 space-y-3">
                  {masterAgents.map((agent) => (
                    <div key={agent.id} className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">{agent.displayName || agent.handle}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            @{agent.handle} · {agent.concept || 'No concept'}
                          </p>
                        </div>
                        <button
                          onClick={() => attachMasterAgentClone(workspaceId, {
                            masterAgentId: agent.id,
                            displayName: agent.displayName || agent.handle,
                            handle: agent.handle,
                            concept: agent.concept,
                          })}
                          className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black"
                        >
                          Clone to World
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {panel === 'PUBLISH' ? (
          <section className="mx-auto max-w-5xl p-8">
            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Publish Plan</h2>
                  <p className="mt-2 text-sm text-neutral-500">
                    Workspace publish is ordered as world → agents → world rules → agent rules.
                  </p>
                </div>
                <button
                  onClick={handlePublish}
                  disabled={!reviewReady}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
                >
                  {publishProgress && publishProgress.phase !== 'DONE'
                    ? `${publishProgress.phase} (${publishProgress.current}/${publishProgress.total})`
                    : t('import.publish', 'Publish')}
                </button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">World Action</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {snapshot.worldDraft.worldId ? 'UPDATE' : 'CREATE'}
                  </p>
                  <p className="mt-2 text-sm text-neutral-400">
                    {snapshot.worldDraft.name || snapshot.workspace.title}
                  </p>
                </div>
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">Agents</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {Object.values(snapshot.agentDrafts).filter((draft) => draft.ownershipType === 'WORLD_OWNED').length}
                  </p>
                  <p className="mt-2 text-sm text-neutral-400">
                    {snapshot.reviewState.agentBundles.length} bundle(s) with truth ready to write
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">Guards</p>
                <div className="mt-3 space-y-2 text-sm text-neutral-400">
                  <p>{snapshot.reviewState.hasPendingConflicts ? 'Blocked: unresolved conflicts remain.' : 'Conflicts resolved.'}</p>
                  <p>{snapshot.reviewState.hasUnmappedCharacters ? 'Blocked: one or more character bundles are not mapped to world-owned agents.' : 'Character bundles mapped to world-owned agents.'}</p>
                  <p>{snapshot.reviewState.worldRules.length} world rule(s) and {snapshot.reviewState.agentBundles.reduce((sum, bundle) => sum + bundle.rules.length, 0)} agent rule(s) will be written.</p>
                </div>
              </div>

              {publishError ? (
                <p className="mt-4 text-sm text-red-400">{publishError}</p>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
