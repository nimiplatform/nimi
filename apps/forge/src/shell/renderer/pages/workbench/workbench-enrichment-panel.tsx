import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import {
  ForgeEmptyState,
  ForgeErrorBanner,
} from '@renderer/components/page-layout.js';
import { ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { formatDate } from '@renderer/components/format-utils.js';
import {
  generateAgentCopyCompletion,
  synthesizeAndBindAgentVoiceSample,
  synthesizeVoiceDemo,
} from '@renderer/data/enrichment-client.js';
import {
  generateEntityImage,
  uploadAndBindAgentAvatar,
  uploadAndBindWorldBanner,
  uploadAndBindWorldIcon,
  uploadImageToCloudflare,
} from '@renderer/data/image-gen-client.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

function computeAgentMissing(agent: {
  description: string;
  scenario: string;
  greeting: string;
  avatarUrl: string | null;
  voiceDemoUrl: string | null;
}): string[] {
  const missing: string[] = [];
  if (!agent.description.trim()) missing.push('description');
  if (!agent.scenario.trim()) missing.push('scenario');
  if (!agent.greeting.trim()) missing.push('greeting');
  if (!agent.avatarUrl) missing.push('avatar');
  if (!agent.voiceDemoUrl) missing.push('voice demo');
  return missing;
}

export function WorkbenchEnrichmentPanel({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const snapshot = useForgeWorkspaceStore((state) => state.workspaces[workspaceId]);
  const patchWorldDraft = useForgeWorkspaceStore((state) => state.patchWorldDraft);
  const updateAgentDraft = useForgeWorkspaceStore((state) => state.updateAgentDraft);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const agentDrafts = useMemo(
    () => snapshot ? Object.values(snapshot.agentDrafts) : [],
    [snapshot],
  );

  if (!snapshot) {
    return <ForgeEmptyState message="Workspace not found." />;
  }

  function getLatestSnapshot() {
    return useForgeWorkspaceStore.getState().workspaces[workspaceId];
  }

  async function generateWorldVisual(target: 'world-banner' | 'world-icon') {
    const current = getLatestSnapshot();
    if (!current) {
      throw new Error('FORGE_ENRICHMENT_WORKSPACE_MISSING');
    }
    const result = await generateEntityImage({
      target,
      worldName: current.worldDraft.name || current.workspace.title,
      worldDescription: current.worldDraft.description,
    });
    const candidate = result.candidates[0];
    if (!candidate) {
      throw new Error(`FORGE_ENRICHMENT_${target.toUpperCase().replace('-', '_')}_CANDIDATE_REQUIRED`);
    }
    if (current.worldDraft.worldId) {
      return target === 'world-banner'
        ? uploadAndBindWorldBanner(current.worldDraft.worldId, candidate.url)
        : uploadAndBindWorldIcon(current.worldDraft.worldId, candidate.url);
    }
    return uploadImageToCloudflare(candidate.url);
  }

  async function enrichWorldDraft() {
    const current = getLatestSnapshot();
    if (!current) {
      throw new Error('FORGE_ENRICHMENT_WORKSPACE_MISSING');
    }
    if (!current.worldDraft.bannerUrl) {
      setStatusText('Generating world banner...');
      const uploaded = await generateWorldVisual('world-banner');
      patchWorldDraft(workspaceId, { bannerUrl: uploaded.url });
    }
    if (!current.worldDraft.iconUrl) {
      setStatusText('Generating world icon...');
      const uploaded = await generateWorldVisual('world-icon');
      patchWorldDraft(workspaceId, { iconUrl: uploaded.url });
    }
  }

  async function enrichAgentDraft(draftAgentId: string) {
    let current = getLatestSnapshot()?.agentDrafts[draftAgentId];
    const latestWorkspace = getLatestSnapshot();
    if (!current || !latestWorkspace) {
      throw new Error('FORGE_ENRICHMENT_AGENT_DRAFT_MISSING');
    }

    const missing = computeAgentMissing(current);
    if (missing.length === 0) {
      return;
    }

    if (!current.description.trim() || !current.scenario.trim() || !current.greeting.trim()) {
      setStatusText(`Completing copy for ${current.displayName}...`);
      const generatedCopy = await generateAgentCopyCompletion({
        worldName: latestWorkspace.worldDraft.name || latestWorkspace.workspace.title,
        worldDescription: latestWorkspace.worldDraft.description,
        displayName: current.displayName,
        concept: current.concept,
        description: current.description,
        scenario: current.scenario,
        greeting: current.greeting,
      });
      const copyPatch = {
        description: current.description.trim() || generatedCopy.description,
        scenario: current.scenario.trim() || generatedCopy.scenario,
        greeting: current.greeting.trim() || generatedCopy.greeting,
      };
      updateAgentDraft(workspaceId, draftAgentId, copyPatch);
      current = { ...current, ...copyPatch };
    }

    if (!current.avatarUrl) {
      setStatusText(`Generating avatar for ${current.displayName}...`);
      const imageResult = await generateEntityImage({
        target: 'agent-avatar',
        agentName: current.displayName,
        agentConcept: current.concept,
        worldName: latestWorkspace.worldDraft.name || latestWorkspace.workspace.title,
        worldDescription: latestWorkspace.worldDraft.description,
      });
      const candidate = imageResult.candidates[0];
      if (!candidate) {
        throw new Error('FORGE_ENRICHMENT_AGENT_AVATAR_CANDIDATE_REQUIRED');
      }
      const uploaded = current.sourceAgentId
        ? await uploadAndBindAgentAvatar(current.sourceAgentId, candidate.url)
        : await uploadImageToCloudflare(candidate.url);
      updateAgentDraft(workspaceId, draftAgentId, { avatarUrl: uploaded.url });
      current = { ...current, avatarUrl: uploaded.url };
    }

    if (!current.voiceDemoUrl) {
      const greetingText = current.greeting.trim();
      if (!greetingText) {
        throw new Error('FORGE_ENRICHMENT_AGENT_GREETING_REQUIRED');
      }
      setStatusText(`Synthesizing voice demo for ${current.displayName}...`);
      const uploaded = current.sourceAgentId && current.worldId
        ? await synthesizeAndBindAgentVoiceSample({
          worldId: current.worldId,
          agentId: current.sourceAgentId,
          text: greetingText,
        })
        : await synthesizeVoiceDemo({ text: greetingText });
      updateAgentDraft(workspaceId, draftAgentId, {
        voiceDemoUrl: uploaded.url,
        voiceDemoResourceId: uploaded.resourceId,
      });
    }
  }

  async function runTask(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      setStatusText('Enrichment complete.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6 p-8">
      <Surface tone="card" material="glass-regular" padding="md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">One-Click Enrichment</h2>
            <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
              Complete missing world visuals plus agent copy, avatar, and voice demo from the current workspace draft.
            </p>
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]">
              Updated {formatDate(snapshot.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              tone="secondary"
              size="sm"
              onClick={() => void runTask(enrichWorldDraft)}
              disabled={busy}
            >
              {busy ? 'Working...' : 'Generate Missing World Assets'}
            </Button>
            <Button
              tone="primary"
              size="sm"
              onClick={() => void runTask(async () => {
                await enrichWorldDraft();
                for (const agent of Object.values(getLatestSnapshot()?.agentDrafts || {})) {
                  await enrichAgentDraft(agent.draftAgentId);
                }
              })}
              disabled={busy || agentDrafts.length === 0}
            >
              {busy ? 'Working...' : 'Complete Missing World + Agents'}
            </Button>
          </div>
        </div>

        {statusText ? (
          <p className="mt-4 rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent)] px-3 py-2 text-sm text-[var(--nimi-text-secondary)]">
            {statusText}
          </p>
        ) : null}

        {error ? <ForgeErrorBanner message={error} className="mt-4" /> : null}
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Surface tone="card" material="glass-regular" padding="md">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">
                World Completeness
              </h3>
              <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
                Banner and icon are treated as first-class world deliverables.
              </p>
            </div>
            <Button
              tone="ghost"
              size="sm"
              onClick={() => navigate(`/workbench/${workspaceId}?panel=WORLD_TRUTH`)}
            >
              Open World Editor
            </Button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Surface tone="panel" padding="sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-[var(--nimi-text-primary)]">Banner</p>
                <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)]">
                  {snapshot.worldDraft.bannerUrl ? 'Ready' : 'Missing'}
                </span>
              </div>
              <div className="mt-3 overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
                {snapshot.worldDraft.bannerUrl ? (
                  <img src={snapshot.worldDraft.bannerUrl} alt="" className="aspect-video w-full object-cover" />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-sm text-[var(--nimi-text-muted)]">
                    No banner yet
                  </div>
                )}
              </div>
            </Surface>

            <Surface tone="panel" padding="sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-[var(--nimi-text-primary)]">Icon</p>
                <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)]">
                  {snapshot.worldDraft.iconUrl ? 'Ready' : 'Missing'}
                </span>
              </div>
              <div className="mt-3 overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
                {snapshot.worldDraft.iconUrl ? (
                  <img src={snapshot.worldDraft.iconUrl} alt="" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-sm text-[var(--nimi-text-muted)]">
                    No icon yet
                  </div>
                )}
              </div>
            </Surface>
          </div>
        </Surface>

        <Surface tone="card" material="glass-thin" padding="md">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">
            Agent Completeness
          </h3>
          <div className="mt-5 space-y-4">
            {agentDrafts.length === 0 ? (
              <ForgeEmptyState message="No world-owned draft agents yet." />
            ) : agentDrafts.map((agentDraft) => {
              const missing = computeAgentMissing(agentDraft);
              return (
                <Surface key={agentDraft.draftAgentId} tone="panel" padding="sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ForgeEntityAvatar src={agentDraft.avatarUrl} name={agentDraft.displayName} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
                          {agentDraft.displayName}
                        </p>
                        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">@{agentDraft.handle}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        tone="secondary"
                        size="sm"
                        onClick={() => navigate(`/workbench/${workspaceId}/agents/${agentDraft.draftAgentId}`)}
                      >
                        Open Agent
                      </Button>
                      <Button
                        tone="primary"
                        size="sm"
                        onClick={() => void runTask(() => enrichAgentDraft(agentDraft.draftAgentId))}
                        disabled={busy || missing.length === 0}
                      >
                        {missing.length === 0 ? 'Complete' : 'Complete Missing'}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {missing.length === 0 ? (
                      <span className="rounded-full bg-[var(--nimi-status-success)]/12 px-2 py-1 text-xs text-[var(--nimi-status-success)]">
                        Ready
                      </span>
                    ) : missing.map((item) => (
                      <span
                        key={item}
                        className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)]"
                      >
                        Missing {item}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">Description</p>
                      <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">
                        {agentDraft.description || 'Missing'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">Scenario</p>
                      <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">
                        {agentDraft.scenario || 'Missing'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">Greeting</p>
                    <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">
                      {agentDraft.greeting || 'Missing'}
                    </p>
                  </div>

                  {agentDraft.voiceDemoUrl ? (
                    <div className="mt-3 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">Voice Demo</p>
                      <audio controls src={agentDraft.voiceDemoUrl} className="mt-2 w-full" />
                    </div>
                  ) : null}
                </Surface>
              );
            })}
          </div>
        </Surface>
      </div>
    </section>
  );
}
