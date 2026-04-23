import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import {
  ForgePage,
  ForgeSection,
  ForgeSectionHeading,
} from '@renderer/components/page-layout.js';
import { ForgeActionCard, ForgeListCard } from '@renderer/components/card-list.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { ForgeEmptyState } from '@renderer/components/page-layout.js';
import { formatDate } from '@renderer/components/format-utils.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

const DEFAULT_NEW_WORLD_WORKSPACE_TITLE = 'New World Workspace';

export default function WorkbenchHomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const orderedWorkspaceIds = useForgeWorkspaceStore((state) => state.orderedWorkspaceIds);
  const workspaces = useForgeWorkspaceStore((state) => state.workspaces);
  const createWorkspace = useForgeWorkspaceStore((state) => state.createWorkspace);
  const removeWorkspace = useForgeWorkspaceStore((state) => state.removeWorkspace);

  const recentWorkspaces = orderedWorkspaceIds
    .map((workspaceId) => workspaces[workspaceId])
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot));

  return (
    <ForgePage maxWidth="max-w-6xl">
      <Surface tone="hero" material="glass-regular" elevation="raised" padding="lg">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--nimi-accent-text)]">
          Forge Workbench
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold text-[var(--nimi-text-primary)]">
          {t('dashboard.title', 'Build worlds, import agents, review truth, and publish from one workspace.')}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--nimi-text-muted)]">
          World is the canonical container. Imports, rule truth, source fidelity, and world-owned agents all converge here before publish.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <ForgeActionCard
            title="New World"
            description="Start a fresh workspace and enter the world truth pipeline immediately."
            onClick={() => {
              const workspaceId = createWorkspace({
                mode: 'NEW_WORLD',
                title: DEFAULT_NEW_WORLD_WORKSPACE_TITLE,
              });
              navigate(`/workbench/${workspaceId}?panel=WORLD_TRUTH`);
            }}
          />
          <ForgeActionCard
            title="Import Character Card"
            description="Load Character Card V2 JSON into a workspace-scoped review flow."
            onClick={() => {
              const workspaceId = createWorkspace({ mode: 'NEW_WORLD', title: 'Character Card Import' });
              navigate(`/workbench/${workspaceId}/import/character-card`);
            }}
          />
          <ForgeActionCard
            title="Import Novel"
            description="Extract chapters progressively, resolve conflicts, then review in the workspace."
            onClick={() => {
              const workspaceId = createWorkspace({ mode: 'NEW_WORLD', title: 'Novel Import' });
              navigate(`/workbench/${workspaceId}/import/novel`);
            }}
          />
        </div>
      </Surface>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
        <ForgeSection>
          <ForgeSectionHeading
            eyebrow="Workspace Memory"
            title="Recent Workspaces"
            description="Reopen incomplete review, maintain a published world, or continue importing into the same workspace."
            action={
              <ForgeStatusBadge
                domain="generic"
                status="count"
                label={String(recentWorkspaces.length)}
                tone="neutral"
              />
            }
          />

          {recentWorkspaces.length === 0 ? (
            <ForgeEmptyState message="No local workspaces yet." />
          ) : (
            <div className="mt-6 space-y-3">
              {recentWorkspaces.map((snapshot) => (
                <ForgeListCard
                  key={snapshot.workspace.workspaceId}
                  title={snapshot.workspace.title}
                  subtitle={[
                    snapshot.worldDraft.name || snapshot.workspace.title,
                    snapshot.worldDraft.worldId ? snapshot.worldDraft.worldId.slice(0, 8) : 'draft',
                    snapshot.importSessions.length > 0 ? `${snapshot.importSessions.length} import session(s)` : '',
                    `Updated ${formatDate(snapshot.updatedAt)}`,
                  ].filter(Boolean).join(' \u00b7 ')}
                  badges={
                    <>
                      <ForgeStatusBadge domain="workspace" status={snapshot.workspace.lifecycle} />
                      <ForgeStatusBadge domain="workspace" status={snapshot.workspace.activePanel} />
                    </>
                  }
                  actions={
                    <>
                      <Button
                        tone="primary"
                        size="sm"
                        onClick={() => navigate(`/workbench/${snapshot.workspace.workspaceId}?panel=${snapshot.workspace.activePanel}`)}
                      >
                        Open
                      </Button>
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => removeWorkspace(snapshot.workspace.workspaceId)}
                      >
                        Remove
                      </Button>
                    </>
                  }
                />
              ))}
            </div>
          )}
        </ForgeSection>

        <ForgeSection material="glass-regular">
          <ForgeSectionHeading
            eyebrow="Execution Path"
            title="Primary Flow"
            description="Keep creation, import, truth review, and publish inside one bounded world workspace."
          />
          <div className="mt-5 space-y-3">
            {[
              'Create or open a world workspace',
              'Import Character Card or Novel into that workspace',
              'Review world truth, agent truth, and source evidence',
              'Publish world, agents, world rules, and agent rules in one ordered plan',
            ].map((item, index) => (
              <div key={item} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-accent-text)_12%,white)] text-xs font-semibold text-[var(--nimi-accent-text)]">
                  {index + 1}
                </div>
                <p className="text-sm text-[var(--nimi-text-muted)]">{item}</p>
              </div>
            ))}
          </div>
        </ForgeSection>
      </section>
    </ForgePage>
  );
}
