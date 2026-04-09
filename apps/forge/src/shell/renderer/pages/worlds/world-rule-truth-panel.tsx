import type { RealmModel } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@renderer/bridge/types.js';
import { useEffect, useState } from 'react';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import type { AgentSummary } from '@renderer/hooks/use-agent-queries.js';
import { LabeledTextField, LabeledTextareaField, LabeledSelectField } from '@renderer/components/form-fields.js';
import { AgentRuleEditor, WorldRuleEditor } from './world-rule-truth-panel-editors.js';
import {
  WORLD_RULE_DOMAIN_OPTIONS,
  WORLD_RULE_SCOPE_OPTIONS,
  AGENT_RULE_LAYER_OPTIONS,
  AGENT_RULE_SCOPE_OPTIONS,
  RULE_CATEGORY_OPTIONS,
  RULE_HARDNESS_OPTIONS,
  buildAgentRulePayload,
  buildWorldRulePayload,
  createAgentRuleForm,
  createWorldRuleForm,
  formatTimestamp,
  toAgentRuleUpdateForm,
  toWorldRuleUpdateForm,
  type AgentRuleFormState,
  type WorldRuleFormState,
} from './world-rule-truth-panel-shared.js';

type AgentRuleDto = RealmModel<'AgentRuleDto'>;
type WorldRuleDto = RealmModel<'WorldRuleDto'>;

type WorldRuleTruthPanelProps = {
  worldRules: WorldRuleDto[];
  worldRulesLoading: boolean;
  worldAgents: AgentSummary[];
  selectedAgentId: string;
  onSelectedAgentIdChange: (value: string) => void;
  agentRules: AgentRuleDto[];
  agentRulesLoading: boolean;
  working: boolean;
  onCreateWorldRule: (payload: JsonObject) => Promise<void>;
  onUpdateWorldRule: (ruleId: string, payload: JsonObject) => Promise<void>;
  onDeprecateWorldRule: (ruleId: string) => Promise<void>;
  onArchiveWorldRule: (ruleId: string) => Promise<void>;
  onCreateAgentRule: (agentId: string, payload: JsonObject) => Promise<void>;
  onUpdateAgentRule: (agentId: string, ruleId: string, payload: JsonObject) => Promise<void>;
  onDeprecateAgentRule: (agentId: string, ruleId: string) => Promise<void>;
  onArchiveAgentRule: (agentId: string, ruleId: string) => Promise<void>;
  setNotice: (message: string | null) => void;
  setError: (message: string | null) => void;
};


export function WorldRuleTruthPanel({
  worldRules,
  worldRulesLoading,
  worldAgents,
  selectedAgentId,
  onSelectedAgentIdChange,
  agentRules,
  agentRulesLoading,
  working,
  onCreateWorldRule,
  onUpdateWorldRule,
  onDeprecateWorldRule,
  onArchiveWorldRule,
  onCreateAgentRule,
  onUpdateAgentRule,
  onDeprecateAgentRule,
  onArchiveAgentRule,
  setNotice,
  setError,
}: WorldRuleTruthPanelProps) {
  const [worldForm, setWorldForm] = useState<WorldRuleFormState>(createWorldRuleForm);
  const [agentForm, setAgentForm] = useState<AgentRuleFormState>(createAgentRuleForm);
  const [editingWorldRuleId, setEditingWorldRuleId] = useState<string | null>(null);
  const [editingAgentRuleId, setEditingAgentRuleId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAgentId && worldAgents.length > 0) {
      onSelectedAgentIdChange(worldAgents[0]!.id);
    }
  }, [onSelectedAgentIdChange, selectedAgentId, worldAgents]);

  const agentOptions = worldAgents.length === 0
    ? [{ value: '', label: 'No world-owned agents' }]
    : worldAgents.map((agent) => ({
      value: agent.id,
      label: agent.displayName || agent.handle || agent.id,
    }));

  return (
    <section className="border-b border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-4 py-4">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">Rule Truth</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--nimi-text-muted)]">
            Worldview and lorebooks below are projection previews. Creator writes now go directly through WorldRule and AgentRule CRUD.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Surface tone="panel" padding="md" className="rounded-xl">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">World Rules</h3>
              <p className="text-xs text-[var(--nimi-text-muted)]">Canonical truth for worldview projection.</p>
            </div>
            <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)]">{worldRules.length} active</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <LabeledTextField
              label="Rule Key"
              value={worldForm.ruleKey}
              onChange={(value) => setWorldForm((state) => ({ ...state, ruleKey: value }))}
              placeholder="axiom:time:flow"
            />
            <LabeledSelectField
              label="Domain"
              value={worldForm.domain}
              options={WORLD_RULE_DOMAIN_OPTIONS}
              onChange={(value) => setWorldForm((state) => ({ ...state, domain: value as WorldRuleFormState['domain'] }))}
            />
            <LabeledTextField
              label="Title"
              value={worldForm.title}
              onChange={(value) => setWorldForm((state) => ({ ...state, title: value }))}
            />
            <LabeledSelectField
              label="Scope"
              value={worldForm.scope}
              options={WORLD_RULE_SCOPE_OPTIONS}
              onChange={(value) => setWorldForm((state) => ({ ...state, scope: value as WorldRuleFormState['scope'] }))}
            />
          </div>

          <LabeledTextareaField
            label="Statement"
            value={worldForm.statement}
            onChange={(value) => setWorldForm((state) => ({ ...state, statement: value }))}
            rows={3}
            className="mt-3"
          />

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <LabeledSelectField
              label="Category"
              value={worldForm.category}
              options={RULE_CATEGORY_OPTIONS}
              onChange={(value) => setWorldForm((state) => ({ ...state, category: value as WorldRuleFormState['category'] }))}
            />
            <LabeledSelectField
              label="Hardness"
              value={worldForm.hardness}
              options={RULE_HARDNESS_OPTIONS}
              onChange={(value) => setWorldForm((state) => ({ ...state, hardness: value as WorldRuleFormState['hardness'] }))}
            />
            <LabeledTextField
              label="Priority"
              value={worldForm.priority}
              onChange={(value) => setWorldForm((state) => ({ ...state, priority: value }))}
            />
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <LabeledTextField
              label="Depends On"
              value={worldForm.dependsOn}
              onChange={(value) => setWorldForm((state) => ({ ...state, dependsOn: value }))}
              placeholder="axiom:time:origin, physics:causality:limit"
            />
            <LabeledTextField
              label="Conflicts With"
              value={worldForm.conflictsWith}
              onChange={(value) => setWorldForm((state) => ({ ...state, conflictsWith: value }))}
            />
            <LabeledTextField
              label="Overrides"
              value={worldForm.overrides}
              onChange={(value) => setWorldForm((state) => ({ ...state, overrides: value }))}
            />
            <LabeledTextField
              label="Source Ref"
              value={worldForm.sourceRef}
              onChange={(value) => setWorldForm((state) => ({ ...state, sourceRef: value }))}
            />
          </div>

          <LabeledTextareaField
            label="Reasoning"
            value={worldForm.reasoning}
            onChange={(value) => setWorldForm((state) => ({ ...state, reasoning: value }))}
            rows={2}
            className="mt-3"
          />

          <LabeledTextareaField
            label="Structured JSON"
            value={worldForm.structuredText}
            onChange={(value) => setWorldForm((state) => ({ ...state, structuredText: value }))}
            rows={5}
            placeholder={'{\n  "timeModel": {\n    "timeFlowRatio": 1\n  }\n}'}
            className="mt-3"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              tone="primary"
              size="sm"
              disabled={working}
              onClick={async () => {
                setError(null);
                const built = buildWorldRulePayload(worldForm);
                if (built.error || !built.payload) {
                  setError(built.error || 'World rule payload is invalid.');
                  return;
                }
                try {
                  await onCreateWorldRule(built.payload);
                  setWorldForm(createWorldRuleForm());
                  setNotice('World rule created.');
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Failed to create world rule.');
                }
              }}
            >
              Create World Rule
            </Button>
            <Button
              tone="secondary"
              size="sm"
              disabled={working}
              onClick={() => setWorldForm(createWorldRuleForm())}
            >
              Reset
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            {worldRulesLoading ? (
              <Surface tone="card" padding="sm" className="text-sm text-[var(--nimi-text-muted)]">Loading world rules...</Surface>
            ) : worldRules.length === 0 ? (
              <Surface tone="card" padding="sm" className="text-sm text-[var(--nimi-text-muted)]">No active world rules yet.</Surface>
            ) : (
              worldRules.map((rule) => {
                const editing = editingWorldRuleId === rule.id;
                const form = editing ? toWorldRuleUpdateForm(rule) : null;
                return (
                  <Surface key={rule.id} tone="card" padding="sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{rule.title}</span>
                          <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--nimi-text-secondary)]">{rule.domain}</span>
                          <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--nimi-text-secondary)]">{rule.scope}</span>
                        </div>
                        <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">{rule.ruleKey} · priority {rule.priority} · updated {formatTimestamp(rule.updatedAt)}</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--nimi-text-secondary)]">{rule.statement}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          tone="ghost"
                          size="sm"
                          disabled={working}
                          onClick={() => {
                            setEditingWorldRuleId(editing ? null : rule.id);
                            setNotice(null);
                          }}
                        >
                          {editing ? 'Close' : 'Edit'}
                        </Button>
                        <Button
                          tone="ghost"
                          size="sm"
                          disabled={working}
                          onClick={async () => {
                            try {
                              await onDeprecateWorldRule(rule.id);
                              setNotice(`Deprecated world rule ${rule.ruleKey}.`);
                            } catch (error) {
                              setError(error instanceof Error ? error.message : 'Failed to deprecate world rule.');
                            }
                          }}
                        >
                          Deprecate
                        </Button>
                        <Button
                          tone="danger"
                          size="sm"
                          disabled={working}
                          onClick={async () => {
                            try {
                              await onArchiveWorldRule(rule.id);
                              setNotice(`Archived world rule ${rule.ruleKey}.`);
                            } catch (error) {
                              setError(error instanceof Error ? error.message : 'Failed to archive world rule.');
                            }
                          }}
                        >
                          Archive
                        </Button>
                      </div>
                    </div>

                    {editing && form ? (
                      <WorldRuleEditor
                        key={rule.id}
                        initialForm={form}
                        working={working}
                        onCancel={() => setEditingWorldRuleId(null)}
                        onSubmit={async (nextForm) => {
                          setError(null);
                          const built = buildWorldRulePayload(nextForm);
                          if (built.error || !built.payload) {
                            setError(built.error || 'World rule payload is invalid.');
                            return;
                          }
                          try {
                            await onUpdateWorldRule(rule.id, {
                              title: built.payload.title,
                              statement: built.payload.statement,
                              category: built.payload.category,
                              hardness: built.payload.hardness,
                              scope: built.payload.scope,
                              priority: built.payload.priority,
                              reasoning: built.payload.reasoning,
                              sourceRef: built.payload.sourceRef,
                              dependsOn: built.payload.dependsOn,
                              conflictsWith: built.payload.conflictsWith,
                              overrides: built.payload.overrides,
                              structured: built.payload.structured,
                            });
                            setEditingWorldRuleId(null);
                            setNotice(`Updated world rule ${rule.ruleKey}.`);
                          } catch (error) {
                            setError(error instanceof Error ? error.message : 'Failed to update world rule.');
                          }
                        }}
                      />
                    ) : null}
                  </Surface>
                );
              })
            )}
          </div>
        </Surface>

        <Surface tone="panel" padding="md" className="rounded-xl">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">Agent Rules</h3>
              <p className="text-xs text-[var(--nimi-text-muted)]">Direct truth for world-owned agent DNA, behavior, and display projection.</p>
            </div>
            <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-1 text-xs text-[var(--nimi-text-secondary)]">{agentRules.length} active</span>
          </div>

          <LabeledSelectField
            label="World Agent"
            value={selectedAgentId}
            options={agentOptions}
            onChange={onSelectedAgentIdChange}
          />

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <LabeledTextField
              label="Rule Key"
              value={agentForm.ruleKey}
              onChange={(value) => setAgentForm((state) => ({ ...state, ruleKey: value }))}
              placeholder="identity:self:core"
            />
            <LabeledSelectField
              label="Layer"
              value={agentForm.layer}
              options={AGENT_RULE_LAYER_OPTIONS}
              onChange={(value) => setAgentForm((state) => ({ ...state, layer: value as AgentRuleFormState['layer'] }))}
            />
            <LabeledTextField
              label="Title"
              value={agentForm.title}
              onChange={(value) => setAgentForm((state) => ({ ...state, title: value }))}
            />
            <LabeledSelectField
              label="Scope"
              value={agentForm.scope}
              options={AGENT_RULE_SCOPE_OPTIONS}
              onChange={(value) => setAgentForm((state) => ({ ...state, scope: value as AgentRuleFormState['scope'] }))}
            />
          </div>

          <LabeledTextareaField
            label="Statement"
            value={agentForm.statement}
            onChange={(value) => setAgentForm((state) => ({ ...state, statement: value }))}
            rows={3}
            className="mt-3"
          />

          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <LabeledSelectField
              label="Category"
              value={agentForm.category}
              options={RULE_CATEGORY_OPTIONS}
              onChange={(value) => setAgentForm((state) => ({ ...state, category: value as AgentRuleFormState['category'] }))}
            />
            <LabeledSelectField
              label="Hardness"
              value={agentForm.hardness}
              options={RULE_HARDNESS_OPTIONS}
              onChange={(value) => setAgentForm((state) => ({ ...state, hardness: value as AgentRuleFormState['hardness'] }))}
            />
            <LabeledTextField
              label="Priority"
              value={agentForm.priority}
              onChange={(value) => setAgentForm((state) => ({ ...state, priority: value }))}
            />
            <LabeledTextField
              label="Importance"
              value={agentForm.importance}
              onChange={(value) => setAgentForm((state) => ({ ...state, importance: value }))}
            />
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <LabeledTextField
              label="Depends On"
              value={agentForm.dependsOn}
              onChange={(value) => setAgentForm((state) => ({ ...state, dependsOn: value }))}
            />
            <LabeledTextField
              label="Conflicts With"
              value={agentForm.conflictsWith}
              onChange={(value) => setAgentForm((state) => ({ ...state, conflictsWith: value }))}
            />
            <LabeledTextField
              label="World Rule Ref"
              value={agentForm.worldRuleRef}
              onChange={(value) => setAgentForm((state) => ({ ...state, worldRuleRef: value }))}
            />
            <LabeledTextField
              label="Source Ref"
              value={agentForm.sourceRef}
              onChange={(value) => setAgentForm((state) => ({ ...state, sourceRef: value }))}
            />
          </div>

          <LabeledTextareaField
            label="Reasoning"
            value={agentForm.reasoning}
            onChange={(value) => setAgentForm((state) => ({ ...state, reasoning: value }))}
            rows={2}
            className="mt-3"
          />

          <LabeledTextareaField
            label="Structured JSON"
            value={agentForm.structuredText}
            onChange={(value) => setAgentForm((state) => ({ ...state, structuredText: value }))}
            rows={5}
            placeholder={'{\n  "persona": {\n    "tone": "calm"\n  }\n}'}
            className="mt-3"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              tone="primary"
              size="sm"
              disabled={working || !selectedAgentId}
              onClick={async () => {
                setError(null);
                if (!selectedAgentId) {
                  setError('Select a world-owned agent before creating an agent rule.');
                  return;
                }
                const built = buildAgentRulePayload(agentForm);
                if (built.error || !built.payload) {
                  setError(built.error || 'Agent rule payload is invalid.');
                  return;
                }
                try {
                  await onCreateAgentRule(selectedAgentId, built.payload);
                  setAgentForm(createAgentRuleForm());
                  setNotice('Agent rule created.');
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Failed to create agent rule.');
                }
              }}
            >
              Create Agent Rule
            </Button>
            <Button
              tone="secondary"
              size="sm"
              disabled={working}
              onClick={() => setAgentForm(createAgentRuleForm())}
            >
              Reset
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            {agentRulesLoading ? (
              <Surface tone="card" padding="sm" className="text-sm text-[var(--nimi-text-muted)]">Loading agent rules...</Surface>
            ) : !selectedAgentId ? (
              <Surface tone="card" padding="sm" className="text-sm text-[var(--nimi-text-muted)]">Select a world-owned agent to manage agent rules.</Surface>
            ) : agentRules.length === 0 ? (
              <Surface tone="card" padding="sm" className="text-sm text-[var(--nimi-text-muted)]">No active agent rules for this agent yet.</Surface>
            ) : (
              agentRules.map((rule) => {
                const editing = editingAgentRuleId === rule.id;
                const form = editing ? toAgentRuleUpdateForm(rule) : null;
                return (
                  <Surface key={rule.id} tone="card" padding="sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{rule.title}</span>
                          <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--nimi-text-secondary)]">{rule.layer}</span>
                          <span className="rounded bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--nimi-text-secondary)]">{rule.scope}</span>
                        </div>
                        <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">{rule.ruleKey} · importance {rule.importance} · updated {formatTimestamp(rule.updatedAt)}</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--nimi-text-secondary)]">{rule.statement}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          tone="ghost"
                          size="sm"
                          disabled={working}
                          onClick={() => {
                            setEditingAgentRuleId(editing ? null : rule.id);
                            setNotice(null);
                          }}
                        >
                          {editing ? 'Close' : 'Edit'}
                        </Button>
                        <Button
                          tone="ghost"
                          size="sm"
                          disabled={working || !selectedAgentId}
                          onClick={async () => {
                            try {
                              await onDeprecateAgentRule(rule.agentId, rule.id);
                              setNotice(`Deprecated agent rule ${rule.ruleKey}.`);
                            } catch (error) {
                              setError(error instanceof Error ? error.message : 'Failed to deprecate agent rule.');
                            }
                          }}
                        >
                          Deprecate
                        </Button>
                        <Button
                          tone="danger"
                          size="sm"
                          disabled={working || !selectedAgentId}
                          onClick={async () => {
                            try {
                              await onArchiveAgentRule(rule.agentId, rule.id);
                              setNotice(`Archived agent rule ${rule.ruleKey}.`);
                            } catch (error) {
                              setError(error instanceof Error ? error.message : 'Failed to archive agent rule.');
                            }
                          }}
                        >
                          Archive
                        </Button>
                      </div>
                    </div>

                    {editing && form ? (
                      <AgentRuleEditor
                        key={rule.id}
                        initialForm={form}
                        working={working}
                        onCancel={() => setEditingAgentRuleId(null)}
                        onSubmit={async (nextForm) => {
                          setError(null);
                          const built = buildAgentRulePayload(nextForm);
                          if (built.error || !built.payload) {
                            setError(built.error || 'Agent rule payload is invalid.');
                            return;
                          }
                          try {
                            await onUpdateAgentRule(rule.agentId, rule.id, {
                              title: built.payload.title,
                              statement: built.payload.statement,
                              category: built.payload.category,
                              hardness: built.payload.hardness,
                              scope: built.payload.scope,
                              importance: built.payload.importance,
                              priority: built.payload.priority,
                              reasoning: built.payload.reasoning,
                              sourceRef: built.payload.sourceRef,
                              dependsOn: built.payload.dependsOn,
                              conflictsWith: built.payload.conflictsWith,
                              worldRuleRef: built.payload.worldRuleRef,
                              structured: built.payload.structured,
                              provenance: built.payload.provenance,
                            });
                            setEditingAgentRuleId(null);
                            setNotice(`Updated agent rule ${rule.ruleKey}.`);
                          } catch (error) {
                            setError(error instanceof Error ? error.message : 'Failed to update agent rule.');
                          }
                        }}
                      />
                    ) : null}
                  </Surface>
                );
              })
            )}
          </div>
        </Surface>
      </div>
    </section>
  );
}
