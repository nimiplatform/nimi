import { Surface } from '@nimiplatform/nimi-kit/ui';
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
    <section className="border-b border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-4 py-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">Rule Truth Preview</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--nimi-text-muted)]">
          Save and publish now use this truth-native draft directly. The patch editors below are local projections derived from these rules.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Surface tone="panel" padding="md" className="rounded-xl">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">World Rules</h3>
              <p className="text-xs text-[var(--nimi-text-muted)]">Derived from the current worldview draft.</p>
            </div>
            <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)]">{worldRules.length}</span>
          </div>
          <div className="space-y-3">
            {worldRules.length === 0 ? (
              <Surface tone="card" padding="sm" className="text-sm text-[var(--nimi-text-muted)]">
                No world rules derived yet.
              </Surface>
            ) : worldRules.map((rule) => (
              <Surface key={String(rule.ruleKey)} tone="card" padding="sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{String(rule.title || 'Untitled Rule')}</span>
                  <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--nimi-text-secondary)]">{String(rule.domain || 'UNKNOWN')}</span>
                  <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--nimi-text-secondary)]">{String(rule.scope || 'WORLD')}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">{String(rule.ruleKey || '')}</div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--nimi-text-secondary)]">{String(rule.statement || '')}</p>
              </Surface>
            ))}
          </div>
        </Surface>

        <Surface tone="panel" padding="md" className="rounded-xl">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">Agent Core Rules</h3>
              <p className="text-xs text-[var(--nimi-text-muted)]">Derived from selected character drafts and synced after publish.</p>
            </div>
            <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)]">{agentRules.length}</span>
          </div>
          <div className="space-y-3">
            {agentRules.length === 0 ? (
              <Surface tone="card" padding="sm" className="text-sm text-[var(--nimi-text-muted)]">
                No agent core rules derived yet.
              </Surface>
            ) : agentRules.map((item) => (
              <Surface key={item.characterName} tone="card" padding="sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{String(item.payload.title || item.characterName)}</span>
                  <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--nimi-text-secondary)]">{String(item.payload.layer || 'DNA')}</span>
                  <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--nimi-text-secondary)]">{String(item.payload.scope || 'SELF')}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">{String(item.payload.ruleKey || '')}</div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--nimi-text-secondary)]">{String(item.payload.statement || '')}</p>
              </Surface>
            ))}
          </div>
        </Surface>
      </div>
    </section>
  );
}
