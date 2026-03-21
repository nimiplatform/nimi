import type { RealmModel } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@renderer/bridge/types.js';
import { useEffect, useState } from 'react';
import type { AgentSummary } from '@renderer/hooks/use-agent-queries.js';
import { AgentRuleEditor, WorldRuleEditor } from './world-rule-truth-panel-editors.js';
import {
  AGENT_RULE_LAYERS,
  AGENT_RULE_SCOPES,
  RULE_CATEGORIES,
  RULE_HARDNESS,
  WORLD_RULE_DOMAINS,
  WORLD_RULE_SCOPES,
  TruthField,
  TruthInput,
  TruthSelect,
  TruthTextarea,
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

  return (
    <section className="border-b border-neutral-800 bg-neutral-950/60 px-4 py-4">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-300">Rule Truth</h2>
          <p className="mt-1 max-w-3xl text-sm text-neutral-500">
            Worldview and lorebooks below are projection previews. Creator writes now go directly through WorldRule and AgentRule CRUD.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">World Rules</h3>
              <p className="text-xs text-neutral-500">Canonical truth for worldview projection.</p>
            </div>
            <span className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300">{worldRules.length} active</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <TruthField label="Rule Key">
              <TruthInput
                value={worldForm.ruleKey}
                onChange={(event) => setWorldForm((state) => ({ ...state, ruleKey: event.target.value }))}
                placeholder="axiom:time:flow"
              />
            </TruthField>
            <TruthField label="Domain">
              <TruthSelect
                value={worldForm.domain}
                onChange={(event) => setWorldForm((state) => ({ ...state, domain: event.target.value as WorldRuleFormState['domain'] }))}
              >
                {WORLD_RULE_DOMAINS.map((item) => <option key={item} value={item}>{item}</option>)}
              </TruthSelect>
            </TruthField>
            <TruthField label="Title">
              <TruthInput
                value={worldForm.title}
                onChange={(event) => setWorldForm((state) => ({ ...state, title: event.target.value }))}
              />
            </TruthField>
            <TruthField label="Scope">
              <TruthSelect
                value={worldForm.scope}
                onChange={(event) => setWorldForm((state) => ({ ...state, scope: event.target.value as WorldRuleFormState['scope'] }))}
              >
                {WORLD_RULE_SCOPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </TruthSelect>
            </TruthField>
          </div>

          <div className="mt-3">
            <TruthField label="Statement">
              <TruthTextarea
                rows={3}
                value={worldForm.statement}
                onChange={(event) => setWorldForm((state) => ({ ...state, statement: event.target.value }))}
              />
            </TruthField>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <TruthField label="Category">
              <TruthSelect
                value={worldForm.category}
                onChange={(event) => setWorldForm((state) => ({ ...state, category: event.target.value as WorldRuleFormState['category'] }))}
              >
                {RULE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </TruthSelect>
            </TruthField>
            <TruthField label="Hardness">
              <TruthSelect
                value={worldForm.hardness}
                onChange={(event) => setWorldForm((state) => ({ ...state, hardness: event.target.value as WorldRuleFormState['hardness'] }))}
              >
                {RULE_HARDNESS.map((item) => <option key={item} value={item}>{item}</option>)}
              </TruthSelect>
            </TruthField>
            <TruthField label="Priority">
              <TruthInput
                value={worldForm.priority}
                onChange={(event) => setWorldForm((state) => ({ ...state, priority: event.target.value }))}
              />
            </TruthField>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TruthField label="Depends On">
              <TruthInput
                value={worldForm.dependsOn}
                onChange={(event) => setWorldForm((state) => ({ ...state, dependsOn: event.target.value }))}
                placeholder="axiom:time:origin, physics:causality:limit"
              />
            </TruthField>
            <TruthField label="Conflicts With">
              <TruthInput
                value={worldForm.conflictsWith}
                onChange={(event) => setWorldForm((state) => ({ ...state, conflictsWith: event.target.value }))}
              />
            </TruthField>
            <TruthField label="Overrides">
              <TruthInput
                value={worldForm.overrides}
                onChange={(event) => setWorldForm((state) => ({ ...state, overrides: event.target.value }))}
              />
            </TruthField>
            <TruthField label="Source Ref">
              <TruthInput
                value={worldForm.sourceRef}
                onChange={(event) => setWorldForm((state) => ({ ...state, sourceRef: event.target.value }))}
              />
            </TruthField>
          </div>

          <div className="mt-3">
            <TruthField label="Reasoning">
              <TruthTextarea
                rows={2}
                value={worldForm.reasoning}
                onChange={(event) => setWorldForm((state) => ({ ...state, reasoning: event.target.value }))}
              />
            </TruthField>
          </div>

          <div className="mt-3">
            <TruthField label="Structured JSON">
              <TruthTextarea
                rows={5}
                value={worldForm.structuredText}
                onChange={(event) => setWorldForm((state) => ({ ...state, structuredText: event.target.value }))}
                placeholder={'{\n  "timeModel": {\n    "timeFlowRatio": 1\n  }\n}'}
              />
            </TruthField>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
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
              className="rounded-md bg-white px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
            >
              Create World Rule
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => setWorldForm(createWorldRuleForm())}
              className="rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
            >
              Reset
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {worldRulesLoading ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-4 text-sm text-neutral-500">Loading world rules…</div>
            ) : worldRules.length === 0 ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-4 text-sm text-neutral-500">No active world rules yet.</div>
            ) : (
              worldRules.map((rule) => {
                const editing = editingWorldRuleId === rule.id;
                const form = editing ? toWorldRuleUpdateForm(rule) : null;
                return (
                  <div key={rule.id} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-white">{rule.title}</span>
                          <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300">{rule.domain}</span>
                          <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300">{rule.scope}</span>
                        </div>
                        <div className="mt-1 text-xs text-neutral-500">{rule.ruleKey} · priority {rule.priority} · updated {formatTimestamp(rule.updatedAt)}</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{rule.statement}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => {
                            setEditingWorldRuleId(editing ? null : rule.id);
                            setNotice(null);
                          }}
                          className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
                        >
                          {editing ? 'Close' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          disabled={working}
                          onClick={async () => {
                            try {
                              await onDeprecateWorldRule(rule.id);
                              setNotice(`Deprecated world rule ${rule.ruleKey}.`);
                            } catch (error) {
                              setError(error instanceof Error ? error.message : 'Failed to deprecate world rule.');
                            }
                          }}
                          className="rounded-md border border-amber-700/60 px-2 py-1 text-xs text-amber-300 transition-colors hover:border-amber-500 hover:text-amber-200 disabled:opacity-50"
                        >
                          Deprecate
                        </button>
                        <button
                          type="button"
                          disabled={working}
                          onClick={async () => {
                            try {
                              await onArchiveWorldRule(rule.id);
                              setNotice(`Archived world rule ${rule.ruleKey}.`);
                            } catch (error) {
                              setError(error instanceof Error ? error.message : 'Failed to archive world rule.');
                            }
                          }}
                          className="rounded-md border border-red-700/60 px-2 py-1 text-xs text-red-300 transition-colors hover:border-red-500 hover:text-red-200 disabled:opacity-50"
                        >
                          Archive
                        </button>
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
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Agent Rules</h3>
              <p className="text-xs text-neutral-500">Direct truth for world-owned agent DNA, behavior, and display projection.</p>
            </div>
            <span className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300">{agentRules.length} active</span>
          </div>

          <TruthField label="World Agent">
            <TruthSelect value={selectedAgentId} onChange={(event) => onSelectedAgentIdChange(event.target.value)}>
              {worldAgents.length === 0 ? <option value="">No world-owned agents</option> : null}
              {worldAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.displayName || agent.handle || agent.id}
                </option>
              ))}
            </TruthSelect>
          </TruthField>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TruthField label="Rule Key">
              <TruthInput
                value={agentForm.ruleKey}
                onChange={(event) => setAgentForm((state) => ({ ...state, ruleKey: event.target.value }))}
                placeholder="identity:self:core"
              />
            </TruthField>
            <TruthField label="Layer">
              <TruthSelect
                value={agentForm.layer}
                onChange={(event) => setAgentForm((state) => ({ ...state, layer: event.target.value as AgentRuleFormState['layer'] }))}
              >
                {AGENT_RULE_LAYERS.map((item) => <option key={item} value={item}>{item}</option>)}
              </TruthSelect>
            </TruthField>
            <TruthField label="Title">
              <TruthInput
                value={agentForm.title}
                onChange={(event) => setAgentForm((state) => ({ ...state, title: event.target.value }))}
              />
            </TruthField>
            <TruthField label="Scope">
              <TruthSelect
                value={agentForm.scope}
                onChange={(event) => setAgentForm((state) => ({ ...state, scope: event.target.value as AgentRuleFormState['scope'] }))}
              >
                {AGENT_RULE_SCOPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </TruthSelect>
            </TruthField>
          </div>

          <div className="mt-3">
            <TruthField label="Statement">
              <TruthTextarea
                rows={3}
                value={agentForm.statement}
                onChange={(event) => setAgentForm((state) => ({ ...state, statement: event.target.value }))}
              />
            </TruthField>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <TruthField label="Category">
              <TruthSelect
                value={agentForm.category}
                onChange={(event) => setAgentForm((state) => ({ ...state, category: event.target.value as AgentRuleFormState['category'] }))}
              >
                {RULE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </TruthSelect>
            </TruthField>
            <TruthField label="Hardness">
              <TruthSelect
                value={agentForm.hardness}
                onChange={(event) => setAgentForm((state) => ({ ...state, hardness: event.target.value as AgentRuleFormState['hardness'] }))}
              >
                {RULE_HARDNESS.map((item) => <option key={item} value={item}>{item}</option>)}
              </TruthSelect>
            </TruthField>
            <TruthField label="Priority">
              <TruthInput
                value={agentForm.priority}
                onChange={(event) => setAgentForm((state) => ({ ...state, priority: event.target.value }))}
              />
            </TruthField>
            <TruthField label="Importance">
              <TruthInput
                value={agentForm.importance}
                onChange={(event) => setAgentForm((state) => ({ ...state, importance: event.target.value }))}
              />
            </TruthField>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TruthField label="Depends On">
              <TruthInput
                value={agentForm.dependsOn}
                onChange={(event) => setAgentForm((state) => ({ ...state, dependsOn: event.target.value }))}
              />
            </TruthField>
            <TruthField label="Conflicts With">
              <TruthInput
                value={agentForm.conflictsWith}
                onChange={(event) => setAgentForm((state) => ({ ...state, conflictsWith: event.target.value }))}
              />
            </TruthField>
            <TruthField label="World Rule Ref">
              <TruthInput
                value={agentForm.worldRuleRef}
                onChange={(event) => setAgentForm((state) => ({ ...state, worldRuleRef: event.target.value }))}
              />
            </TruthField>
            <TruthField label="Source Ref">
              <TruthInput
                value={agentForm.sourceRef}
                onChange={(event) => setAgentForm((state) => ({ ...state, sourceRef: event.target.value }))}
              />
            </TruthField>
          </div>

          <div className="mt-3">
            <TruthField label="Reasoning">
              <TruthTextarea
                rows={2}
                value={agentForm.reasoning}
                onChange={(event) => setAgentForm((state) => ({ ...state, reasoning: event.target.value }))}
              />
            </TruthField>
          </div>

          <div className="mt-3">
            <TruthField label="Structured JSON">
              <TruthTextarea
                rows={5}
                value={agentForm.structuredText}
                onChange={(event) => setAgentForm((state) => ({ ...state, structuredText: event.target.value }))}
                placeholder={'{\n  "persona": {\n    "tone": "calm"\n  }\n}'}
              />
            </TruthField>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
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
              className="rounded-md bg-white px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
            >
              Create Agent Rule
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => setAgentForm(createAgentRuleForm())}
              className="rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
            >
              Reset
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {agentRulesLoading ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-4 text-sm text-neutral-500">Loading agent rules…</div>
            ) : !selectedAgentId ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-4 text-sm text-neutral-500">Select a world-owned agent to manage agent rules.</div>
            ) : agentRules.length === 0 ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-4 text-sm text-neutral-500">No active agent rules for this agent yet.</div>
            ) : (
              agentRules.map((rule) => {
                const editing = editingAgentRuleId === rule.id;
                const form = editing ? toAgentRuleUpdateForm(rule) : null;
                return (
                  <div key={rule.id} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-white">{rule.title}</span>
                          <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300">{rule.layer}</span>
                          <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-300">{rule.scope}</span>
                        </div>
                        <div className="mt-1 text-xs text-neutral-500">{rule.ruleKey} · importance {rule.importance} · updated {formatTimestamp(rule.updatedAt)}</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{rule.statement}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => {
                            setEditingAgentRuleId(editing ? null : rule.id);
                            setNotice(null);
                          }}
                          className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
                        >
                          {editing ? 'Close' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          disabled={working || !selectedAgentId}
                          onClick={async () => {
                            try {
                              await onDeprecateAgentRule(rule.agentId, rule.id);
                              setNotice(`Deprecated agent rule ${rule.ruleKey}.`);
                            } catch (error) {
                              setError(error instanceof Error ? error.message : 'Failed to deprecate agent rule.');
                            }
                          }}
                          className="rounded-md border border-amber-700/60 px-2 py-1 text-xs text-amber-300 transition-colors hover:border-amber-500 hover:text-amber-200 disabled:opacity-50"
                        >
                          Deprecate
                        </button>
                        <button
                          type="button"
                          disabled={working || !selectedAgentId}
                          onClick={async () => {
                            try {
                              await onArchiveAgentRule(rule.agentId, rule.id);
                              setNotice(`Archived agent rule ${rule.ruleKey}.`);
                            } catch (error) {
                              setError(error instanceof Error ? error.message : 'Failed to archive agent rule.');
                            }
                          }}
                          className="rounded-md border border-red-700/60 px-2 py-1 text-xs text-red-300 transition-colors hover:border-red-500 hover:text-red-200 disabled:opacity-50"
                        >
                          Archive
                        </button>
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
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
