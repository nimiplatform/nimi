import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import type { ForgeWorkspacePanel } from '@renderer/features/workbench/types.js';
import { useAgentListQuery } from '@renderer/hooks/use-agent-queries.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import { WorldCreatePageView } from '@renderer/pages/worlds/world-create-page.js';
import { WorldMaintainPageView } from '@renderer/pages/worlds/world-maintain-page.js';
import { publishForgeWorkspacePlan, type PublishProgress } from '@renderer/features/import/data/import-publish-client.js';
import { useImageGeneration } from '@renderer/hooks/use-image-generation.js';
import type { ImageGenEntityContext } from '@renderer/data/image-gen-client.js';
import { ForgeEmptyState, ForgeErrorBanner, ForgeStatCard } from '@renderer/components/page-layout.js';
import { ForgeActionCard, ForgeListCard } from '@renderer/components/card-list.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { LabeledTextField, LabeledTextareaField } from '@renderer/components/form-fields.js';
import { formatDate } from '@renderer/components/format-utils.js';

type WorkbenchPanel = ForgeWorkspacePanel;

const PANELS: WorkbenchPanel[] = [
  'OVERVIEW',
  'WORLD_TRUTH',
  'IMPORT',
  'REVIEW',
  'AGENTS',
  'PUBLISH',
];

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
        <ForgeEmptyState
          message="Workspace not found."
          action="Back to Workbench"
          onAction={() => navigate('/workbench')}
        />
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
      {/* Sidebar */}
      <aside className="w-72 shrink-0 border-r border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-4 py-5">
        <Button
          tone="ghost"
          size="sm"
          onClick={() => navigate('/workbench')}
          className="text-xs uppercase tracking-[0.18em]"
        >
          Workbench
        </Button>
        <div className="mt-4">
          <h1 className="text-xl font-semibold text-[var(--nimi-text-primary)]">{snapshot.workspace.title}</h1>
          <p className="mt-1 text-sm text-[var(--nimi-text-muted)]">
            {snapshot.worldDraft.worldId ? `World ${snapshot.worldDraft.worldId.slice(0, 8)}` : 'Local draft workspace'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ForgeStatusBadge domain="workspace" status={snapshot.workspace.lifecycle} />
            <ForgeStatusBadge domain="workspace" status="WORLD_TRUTH" label={`${snapshot.reviewState.worldRules.length} world rules`} tone="info" />
            <ForgeStatusBadge domain="workspace" status="AGENTS" label={`${snapshot.reviewState.agentBundles.length} agents`} tone="success" />
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          {PANELS.map((item) => (
            <Button
              key={item}
              tone={panel === item ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => openPanel(item)}
              className="w-full justify-start rounded-xl text-left"
            >
              {item.replaceAll('_', ' ')}
            </Button>
          ))}
        </nav>

        <Surface tone="card" padding="sm" className="mt-8">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]">Local Status</p>
          <div className="mt-3 space-y-2 text-sm text-[var(--nimi-text-secondary)]">
            <p>{snapshot.importSessions.length} import session(s)</p>
            <p>{snapshot.reviewState.conflicts.length} conflict record(s)</p>
            <p>Updated {formatDate(snapshot.updatedAt)}</p>
          </div>
        </Surface>
      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1 overflow-auto bg-[var(--nimi-surface-canvas)]">
        {/* OVERVIEW panel */}
        {panel === 'OVERVIEW' ? (
          <section className="mx-auto max-w-6xl p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
              <Surface tone="card" padding="md">
                <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Workspace Overview</h2>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <LabeledTextField
                    label="World Name"
                    value={snapshot.worldDraft.name}
                    onChange={(value) => patchWorldDraft(workspaceId, { name: value })}
                  />
                  <LabeledTextField
                    label="Source Type"
                    value={snapshot.worldDraft.sourceType}
                    readOnly
                  />
                </div>
                <LabeledTextareaField
                  label="Description"
                  value={snapshot.worldDraft.description}
                  onChange={(value) => patchWorldDraft(workspaceId, { description: value })}
                  rows={4}
                  className="mt-4"
                />

                <div className="mt-6 grid gap-3 md:grid-cols-4">
                  <ForgeStatCard label="World Rules" value={snapshot.reviewState.worldRules.length} />
                  <ForgeStatCard label="Agent Bundles" value={snapshot.reviewState.agentBundles.length} />
                  <ForgeStatCard label="Import Sessions" value={snapshot.importSessions.length} />
                  <ForgeStatCard label="Conflicts" value={snapshot.reviewState.conflicts.length} />
                </div>
              </Surface>

              <Surface tone="card" padding="md">
                <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Next Action</h2>
                <div className="mt-5 space-y-3">
                  <ForgeActionCard title="Continue World Truth" onClick={() => openPanel('WORLD_TRUTH')} />
                  <ForgeActionCard title="Import Character Card" onClick={() => navigate(`/workbench/${workspaceId}/import/character-card`)} />
                  <ForgeActionCard title="Import Novel" onClick={() => navigate(`/workbench/${workspaceId}/import/novel`)} />
                  <ForgeActionCard title="Review Truth Draft" onClick={() => openPanel('REVIEW')} />
                </div>
              </Surface>
            </div>

            {/* World Visuals */}
            <Surface tone="card" padding="md" className="mt-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">World Visuals</h2>
                <div className="flex gap-2">
                  <Button
                    tone="primary"
                    size="sm"
                    onClick={() => void imageGen.generate(buildWorldImageContext('world-banner'))}
                    disabled={imageGen.busy}
                  >
                    {imageGen.busy ? (VISUAL_PHASE_LABELS[imageGen.phase] || imageGen.phase) : 'Generate Banner'}
                  </Button>
                  <Button
                    tone="secondary"
                    size="sm"
                    onClick={() => void imageGen.generate(buildWorldImageContext('world-icon'))}
                    disabled={imageGen.busy}
                  >
                    Generate Icon
                  </Button>
                </div>
              </div>

              <div className="mt-3">
                <LabeledTextField
                  label=""
                  value={visualPrompt}
                  onChange={setVisualPrompt}
                  placeholder="Additional prompt instructions (optional)..."
                />
              </div>

              {imageGen.error ? (
                <div className="mt-3">
                  <ForgeErrorBanner message={imageGen.error} />
                  <Button tone="ghost" size="sm" onClick={imageGen.clearError} className="mt-1 text-xs text-[var(--nimi-status-danger)]">
                    Dismiss
                  </Button>
                </div>
              ) : null}

              {imageGen.candidates.length > 0 ? (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {imageGen.candidates.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="group relative overflow-hidden rounded-[var(--nimi-radius-card)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]"
                    >
                      <img src={candidate.url} alt="" className="aspect-video w-full object-cover" />
                      <div className="absolute inset-0 flex items-end bg-black/60 p-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <div className="flex w-full gap-1.5">
                          {snapshot.worldDraft.worldId ? (
                            <>
                              <Button
                                tone="primary"
                                size="sm"
                                onClick={() => void imageGen.useAsWorldBanner(snapshot.worldDraft.worldId!, candidate)}
                                disabled={imageGen.busy}
                                className="flex-1"
                              >
                                Set as Banner
                              </Button>
                              <Button
                                tone="secondary"
                                size="sm"
                                onClick={() => void imageGen.useAsWorldIcon(snapshot.worldDraft.worldId!, candidate)}
                                disabled={imageGen.busy}
                                className="flex-1"
                              >
                                Set as Icon
                              </Button>
                            </>
                          ) : null}
                          <Button
                            tone="ghost"
                            size="sm"
                            onClick={() => void imageGen.saveToLibrary(candidate)}
                            disabled={imageGen.busy}
                          >
                            Save
                          </Button>
                          <Button
                            tone="ghost"
                            size="sm"
                            onClick={() => imageGen.removeCandidate(candidate.id)}
                          >
                            &times;
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {!snapshot.worldDraft.worldId && imageGen.candidates.length > 0 ? (
                <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
                  Publish the world first to bind images as banner or icon.
                </p>
              ) : null}
            </Surface>
          </section>
        ) : null}

        {/* WORLD_TRUTH panel */}
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

        {/* IMPORT panel */}
        {panel === 'IMPORT' ? (
          <section className="mx-auto max-w-5xl p-8">
            <Surface tone="card" padding="md">
              <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Import into Workspace</h2>
              <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
                Import pipelines no longer publish directly. They write source fidelity and review drafts back into this workspace.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button tone="primary" size="sm" onClick={() => navigate(`/workbench/${workspaceId}/import/character-card`)}>
                  Character Card
                </Button>
                <Button tone="secondary" size="sm" onClick={() => navigate(`/workbench/${workspaceId}/import/novel`)}>
                  Novel
                </Button>
              </div>

              <div className="mt-6 space-y-3">
                {snapshot.importSessions.length === 0 ? (
                  <ForgeEmptyState message="No import sessions recorded yet." />
                ) : snapshot.importSessions.map((session) => (
                  <ForgeListCard
                    key={session.sessionId}
                    title={session.sourceFile}
                    subtitle={`${session.sessionType} \u00b7 ${session.status} \u00b7 ${session.unresolvedConflicts} unresolved conflict(s)`}
                    actions={
                      <Button tone="secondary" size="sm" onClick={() => openPanel('REVIEW')}>
                        Open Review
                      </Button>
                    }
                  />
                ))}
              </div>
            </Surface>
          </section>
        ) : null}

        {/* REVIEW panel */}
        {panel === 'REVIEW' ? (
          <section className="mx-auto max-w-6xl space-y-6 p-8">
            <Surface tone="card" padding="md">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Unified Review</h2>
                  <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
                    Seed rules, import evidence, and world-owned agent drafts all converge here before publish.
                  </p>
                </div>
                <Button tone="primary" size="sm" onClick={() => openPanel('PUBLISH')} disabled={!reviewReady}>
                  Build Publish Plan
                </Button>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <ForgeStatusBadge
                  domain="generic"
                  status={snapshot.reviewState.hasPendingConflicts ? 'PENDING' : 'CLEAR'}
                  label={snapshot.reviewState.hasPendingConflicts ? 'Conflicts Pending' : 'Conflicts Clear'}
                  tone={snapshot.reviewState.hasPendingConflicts ? 'danger' : 'success'}
                />
                <ForgeStatusBadge
                  domain="generic"
                  status={snapshot.reviewState.hasUnmappedCharacters ? 'UNMAPPED' : 'MAPPED'}
                  label={snapshot.reviewState.hasUnmappedCharacters ? 'Character Mapping Needed' : 'Character Mapping Ready'}
                  tone={snapshot.reviewState.hasUnmappedCharacters ? 'warning' : 'info'}
                />
              </div>
            </Surface>

            {/* Conflict Diff */}
            {snapshot.reviewState.conflicts.length > 0 ? (
              <Surface tone="card" padding="md" className="border-[var(--nimi-status-danger)]">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-status-danger)]">Conflict Diff</h3>
                <div className="mt-4 space-y-3">
                  {snapshot.reviewState.conflicts.map((conflict) => (
                    <Surface key={`${conflict.sessionId}:${conflict.ruleKey}`} tone="card" padding="sm">
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-[var(--nimi-text-muted)]">{conflict.ruleKey}</code>
                        <ForgeStatusBadge domain="generic" status={conflict.resolution} tone="neutral" />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <Surface tone="panel" padding="sm">
                          <p className="text-xs text-[var(--nimi-text-muted)]">Previous</p>
                          <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{conflict.previousStatement}</p>
                        </Surface>
                        <Surface tone="panel" padding="sm">
                          <p className="text-xs text-[var(--nimi-text-muted)]">New</p>
                          <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{conflict.newStatement}</p>
                        </Surface>
                      </div>
                      {conflict.mergedStatement ? (
                        <Surface tone="panel" padding="sm" className="mt-3 border-[var(--nimi-status-success)]">
                          <p className="text-xs text-[var(--nimi-status-success)]">Merged Preview</p>
                          <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{conflict.mergedStatement}</p>
                        </Surface>
                      ) : null}
                    </Surface>
                  ))}
                </div>
              </Surface>
            ) : null}

            {/* World Rules */}
            <Surface tone="card" padding="md">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">World Rules</h3>
              <div className="mt-4 space-y-4">
                {snapshot.reviewState.worldRules.length === 0 ? (
                  <ForgeEmptyState message="No workspace-scoped world rules yet." />
                ) : snapshot.reviewState.worldRules.map((rule, index) => (
                  <Surface key={rule.ruleKey} tone="card" padding="sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-xs text-[var(--nimi-text-muted)]">{rule.ruleKey}</code>
                      <ForgeStatusBadge domain="generic" status={rule.domain} tone="info" />
                      <select
                        value={rule.hardness}
                        onChange={(event) => updateReviewWorldRule(workspaceId, index, {
                          hardness: event.target.value as typeof rule.hardness,
                        })}
                        className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-2 py-1 text-xs text-[var(--nimi-text-primary)]"
                      >
                        <option value="AESTHETIC">AESTHETIC</option>
                        <option value="SOFT">SOFT</option>
                        <option value="FIRM">FIRM</option>
                        <option value="HARD">HARD</option>
                      </select>
                    </div>
                    <LabeledTextField
                      label=""
                      value={rule.title}
                      onChange={(value) => updateReviewWorldRule(workspaceId, index, { title: value })}
                      className="mt-3"
                    />
                    <LabeledTextareaField
                      label=""
                      value={rule.statement}
                      onChange={(value) => updateReviewWorldRule(workspaceId, index, { statement: value })}
                      rows={3}
                      className="mt-3"
                    />
                  </Surface>
                ))}
              </div>
            </Surface>

            {/* Agent Truth */}
            <Surface tone="card" padding="md">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">Agent Truth</h3>
              <div className="mt-4 space-y-4">
                {snapshot.reviewState.agentBundles.map((bundle) => {
                  const agentDraft = snapshot.agentDrafts[bundle.draftAgentId];
                  return (
                    <Surface key={bundle.draftAgentId} tone="card" padding="sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{agentDraft?.displayName || bundle.characterName}</p>
                          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{agentDraft?.handle || 'draft-handle'}</p>
                        </div>
                        <Button
                          tone="secondary"
                          size="sm"
                          onClick={() => navigate(`/workbench/${workspaceId}/agents/${bundle.draftAgentId}`)}
                        >
                          Open Agent
                        </Button>
                      </div>
                      <div className="mt-4 space-y-3">
                        {bundle.rules.map((rule, index) => (
                          <Surface key={rule.ruleKey} tone="panel" padding="sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <code className="text-xs text-[var(--nimi-text-muted)]">{rule.ruleKey}</code>
                              <ForgeStatusBadge domain="generic" status={rule.layer} tone="neutral" />
                            </div>
                            <LabeledTextField
                              label=""
                              value={rule.title}
                              onChange={(value) => updateReviewAgentRule(workspaceId, bundle.draftAgentId, index, {
                                title: value,
                              })}
                              className="mt-3"
                            />
                            <LabeledTextareaField
                              label=""
                              value={rule.statement}
                              onChange={(value) => updateReviewAgentRule(workspaceId, bundle.draftAgentId, index, {
                                statement: value,
                              })}
                              rows={3}
                              className="mt-3"
                            />
                          </Surface>
                        ))}
                      </div>
                    </Surface>
                  );
                })}
              </div>
            </Surface>
          </section>
        ) : null}

        {/* AGENTS panel */}
        {panel === 'AGENTS' ? (
          <section className="mx-auto max-w-6xl p-8">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <Surface tone="card" padding="md">
                <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">World-Owned Draft Agents</h2>
                <div className="mt-5 space-y-3">
                  {Object.values(snapshot.agentDrafts).length === 0 ? (
                    <ForgeEmptyState message="No world-owned draft agents yet." />
                  ) : Object.values(snapshot.agentDrafts).map((agentDraft) => (
                    <ForgeListCard
                      key={agentDraft.draftAgentId}
                      title={agentDraft.displayName}
                      subtitle={`@${agentDraft.handle} \u00b7 ${agentDraft.source} \u00b7 ${agentDraft.status}`}
                      actions={
                        <Button
                          tone="secondary"
                          size="sm"
                          onClick={() => navigate(`/workbench/${workspaceId}/agents/${agentDraft.draftAgentId}`)}
                        >
                          Open
                        </Button>
                      }
                    />
                  ))}
                </div>
              </Surface>

              <Surface tone="card" padding="md">
                <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Master Agent Library</h2>
                <div className="mt-5 space-y-3">
                  {masterAgents.map((agent) => (
                    <ForgeListCard
                      key={agent.id}
                      title={agent.displayName || agent.handle}
                      subtitle={`@${agent.handle} \u00b7 ${agent.concept || 'No concept'}`}
                      actions={
                        <Button
                          tone="primary"
                          size="sm"
                          onClick={() => attachMasterAgentClone(workspaceId, {
                            masterAgentId: agent.id,
                            displayName: agent.displayName || agent.handle,
                            handle: agent.handle,
                            concept: agent.concept,
                          })}
                        >
                          Clone to World
                        </Button>
                      }
                    />
                  ))}
                </div>
              </Surface>
            </div>
          </section>
        ) : null}

        {/* PUBLISH panel */}
        {panel === 'PUBLISH' ? (
          <section className="mx-auto max-w-5xl p-8">
            <Surface tone="card" padding="md">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Publish Plan</h2>
                  <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
                    Workspace publish is ordered as world &rarr; agents &rarr; world rules &rarr; agent rules.
                  </p>
                </div>
                <Button
                  tone="primary"
                  size="sm"
                  onClick={handlePublish}
                  disabled={!reviewReady}
                >
                  {publishProgress && publishProgress.phase !== 'DONE'
                    ? `${publishProgress.phase} (${publishProgress.current}/${publishProgress.total})`
                    : t('import.publish', 'Publish')}
                </Button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <ForgeStatCard
                  label="World Action"
                  value={snapshot.worldDraft.worldId ? 'UPDATE' : 'CREATE'}
                  detail={snapshot.worldDraft.name || snapshot.workspace.title}
                />
                <ForgeStatCard
                  label="Agents"
                  value={Object.values(snapshot.agentDrafts).filter((draft) => draft.ownershipType === 'WORLD_OWNED').length}
                  detail={`${snapshot.reviewState.agentBundles.length} bundle(s) with truth ready to write`}
                />
              </div>

              <Surface tone="card" padding="sm" className="mt-6">
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">Guards</p>
                <div className="mt-3 space-y-2 text-sm text-[var(--nimi-text-secondary)]">
                  <p>{snapshot.reviewState.hasPendingConflicts ? 'Blocked: unresolved conflicts remain.' : 'Conflicts resolved.'}</p>
                  <p>{snapshot.reviewState.hasUnmappedCharacters ? 'Blocked: one or more character bundles are not mapped to world-owned agents.' : 'Character bundles mapped to world-owned agents.'}</p>
                  <p>{snapshot.reviewState.worldRules.length} world rule(s) and {snapshot.reviewState.agentBundles.reduce((sum, bundle) => sum + bundle.rules.length, 0)} agent rule(s) will be written.</p>
                </div>
              </Surface>

              {publishError ? (
                <ForgeErrorBanner message={publishError} className="mt-4" />
              ) : null}
            </Surface>
          </section>
        ) : null}
      </main>
    </div>
  );
}
