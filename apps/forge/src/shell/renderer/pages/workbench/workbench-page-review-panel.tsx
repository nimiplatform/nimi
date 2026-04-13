import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeEmptyState } from '@renderer/components/page-layout.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { LabeledTextField, LabeledTextareaField } from '@renderer/components/form-fields.js';
import type { LocalAgentRuleDraft, LocalWorldRuleDraft } from '@renderer/features/import/types.js';
import type { WorkbenchPageSnapshot } from './workbench-page-shared.js';

type WorkbenchPageReviewPanelProps = {
  snapshot: WorkbenchPageSnapshot;
  reviewReady: boolean;
  onOpenPublish: () => void;
  onOpenAgentDraft: (draftAgentId: string) => void;
  onUpdateWorldRule: (index: number, patch: Partial<LocalWorldRuleDraft>) => void;
  onUpdateAgentRule: (draftAgentId: string, index: number, patch: Partial<LocalAgentRuleDraft>) => void;
};

export function WorkbenchPageReviewPanel({
  snapshot,
  reviewReady,
  onOpenPublish,
  onOpenAgentDraft,
  onUpdateWorldRule,
  onUpdateAgentRule,
}: WorkbenchPageReviewPanelProps) {
  return (
    <section className="mx-auto max-w-6xl space-y-6 p-8">
      <Surface tone="card" padding="md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Unified Review</h2>
            <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
              Seed rules, import evidence, and world-owned agent drafts all converge here before publish.
            </p>
          </div>
          <Button tone="primary" size="sm" onClick={onOpenPublish} disabled={!reviewReady}>
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
                  onChange={(event) => onUpdateWorldRule(index, {
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
                onChange={(value) => onUpdateWorldRule(index, { title: value })}
                className="mt-3"
              />
              <LabeledTextareaField
                label=""
                value={rule.statement}
                onChange={(value) => onUpdateWorldRule(index, { statement: value })}
                rows={3}
                className="mt-3"
              />
            </Surface>
          ))}
        </div>
      </Surface>

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
                    onClick={() => onOpenAgentDraft(bundle.draftAgentId)}
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
                        onChange={(value) => onUpdateAgentRule(bundle.draftAgentId, index, {
                          title: value,
                        })}
                        className="mt-3"
                      />
                      <LabeledTextareaField
                        label=""
                        value={rule.statement}
                        onChange={(value) => onUpdateAgentRule(bundle.draftAgentId, index, {
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
  );
}
