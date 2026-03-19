import type { WorldStudioWorkspaceSnapshot } from '@world-engine/contracts.js';
import {
  resolveRuleTruthDraft,
} from './world-create-page-helpers.js';

type WorldCreateRuleTruthPreviewProps = {
  snapshot: WorldStudioWorkspaceSnapshot;
};

export function WorldCreateRuleTruthPreview({
  snapshot,
}: WorldCreateRuleTruthPreviewProps) {
  const truthDraft = resolveRuleTruthDraft(snapshot);
  const worldRules = truthDraft.worldRules;
  const agentRules = truthDraft.agentRules;

  if (worldRules.length === 0 && agentRules.length === 0) {
    return null;
  }

  return (
    <section className="border-b border-neutral-800 bg-neutral-950/60 px-4 py-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-300">Rule Truth Preview</h2>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">
          Save and publish now use this truth-native draft directly. The patch editors below are local projections derived from these rules.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">World Rules</h3>
              <p className="text-xs text-neutral-500">Derived from the current worldview draft.</p>
            </div>
            <span className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300">{worldRules.length}</span>
          </div>
          <div className="space-y-3">
            {worldRules.length === 0 ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-4 text-sm text-neutral-500">
                No world rules derived yet.
              </div>
            ) : worldRules.map((rule) => (
              <div key={String(rule.ruleKey)} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">{String(rule.title || 'Untitled Rule')}</span>
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300">{String(rule.domain || 'UNKNOWN')}</span>
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300">{String(rule.scope || 'WORLD')}</span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">{String(rule.ruleKey || '')}</div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{String(rule.statement || '')}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Agent Core Rules</h3>
              <p className="text-xs text-neutral-500">Derived from selected character drafts and synced after publish.</p>
            </div>
            <span className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300">{agentRules.length}</span>
          </div>
          <div className="space-y-3">
            {agentRules.length === 0 ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-4 text-sm text-neutral-500">
                No agent core rules derived yet.
              </div>
            ) : agentRules.map((item) => (
              <div key={item.characterName} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">{String(item.payload.title || item.characterName)}</span>
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300">{String(item.payload.layer || 'DNA')}</span>
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300">{String(item.payload.scope || 'SELF')}</span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">{String(item.payload.ruleKey || '')}</div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{String(item.payload.statement || '')}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
