import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

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
    <div className="h-full overflow-auto p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-3xl border border-neutral-800 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_42%),linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(2,6,23,0.94))] p-8">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-sky-300/80">
            Forge Workbench
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold text-white">
            {t('dashboard.title', 'Build worlds, import agents, review truth, and publish from one workspace.')}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
            World is the canonical container. Imports, rule truth, source fidelity, and world-owned agents all converge here before publish.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <button
              onClick={() => {
                const workspaceId = createWorkspace({ mode: 'NEW_WORLD', title: 'Untitled World' });
                navigate(`/workbench/${workspaceId}?panel=WORLD_TRUTH`);
              }}
              className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left transition-colors hover:border-white/20 hover:bg-white/10"
            >
              <p className="text-sm font-semibold text-white">New World</p>
              <p className="mt-2 text-sm text-neutral-400">
                Start a fresh workspace and enter the world truth pipeline immediately.
              </p>
            </button>

            <button
              onClick={() => {
                const workspaceId = createWorkspace({ mode: 'NEW_WORLD', title: 'Character Card Import' });
                navigate(`/workbench/${workspaceId}/import/character-card`);
              }}
              className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left transition-colors hover:border-white/20 hover:bg-white/10"
            >
              <p className="text-sm font-semibold text-white">Import Character Card</p>
              <p className="mt-2 text-sm text-neutral-400">
                Load Character Card V2 JSON into a workspace-scoped review flow.
              </p>
            </button>

            <button
              onClick={() => {
                const workspaceId = createWorkspace({ mode: 'NEW_WORLD', title: 'Novel Import' });
                navigate(`/workbench/${workspaceId}/import/novel`);
              }}
              className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left transition-colors hover:border-white/20 hover:bg-white/10"
            >
              <p className="text-sm font-semibold text-white">Import Novel</p>
              <p className="mt-2 text-sm text-neutral-400">
                Extract chapters progressively, resolve conflicts, then review in the workspace.
              </p>
            </button>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Recent Workspaces</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  Reopen incomplete review, maintain a published world, or continue importing into the same workspace.
                </p>
              </div>
              <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-300">
                {recentWorkspaces.length}
              </span>
            </div>

            {recentWorkspaces.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/70 p-8 text-center text-sm text-neutral-500">
                No local workspaces yet.
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {recentWorkspaces.map((snapshot) => (
                  <div
                    key={snapshot.workspace.workspaceId}
                    className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-white">
                            {snapshot.workspace.title}
                          </h3>
                          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-neutral-300">
                            {snapshot.workspace.lifecycle}
                          </span>
                          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-sky-300">
                            {snapshot.workspace.activePanel}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-neutral-400">
                          {snapshot.worldDraft.name || 'Untitled World'}
                          {snapshot.worldDraft.worldId ? ` · ${snapshot.worldDraft.worldId.slice(0, 8)}` : ' · draft'}
                          {snapshot.importSessions.length > 0 ? ` · ${snapshot.importSessions.length} import session(s)` : ''}
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">
                          Updated {formatDate(snapshot.updatedAt)}
                        </p>
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => navigate(`/workbench/${snapshot.workspace.workspaceId}?panel=${snapshot.workspace.activePanel}`)}
                          className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-neutral-200"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => removeWorkspace(snapshot.workspace.workspaceId)}
                          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:border-red-500/40 hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
            <h2 className="text-lg font-semibold text-white">Primary Flow</h2>
            <div className="mt-5 space-y-3">
              {[
                'Create or open a world workspace',
                'Import Character Card or Novel into that workspace',
                'Review world truth, agent truth, and source evidence',
                'Publish world, agents, world rules, and agent rules in one ordered plan',
              ].map((item, index) => (
                <div key={item} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800 text-xs text-neutral-300">
                    {index + 1}
                  </div>
                  <p className="text-sm text-neutral-400">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
