import type { RealmModel } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@renderer/bridge/types.js';
import {
  useEffect,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type { AgentSummary } from '@renderer/hooks/use-agent-queries.js';

type AgentRuleDto = RealmModel<'AgentRuleDto'>;
type WorldRuleDto = RealmModel<'WorldRuleDto'>;

const WORLD_RULE_DOMAINS = ['AXIOM', 'PHYSICS', 'SOCIETY', 'ECONOMY', 'CHARACTER', 'NARRATIVE', 'META'] as const;
const WORLD_RULE_SCOPES = ['WORLD', 'REGION', 'FACTION', 'INDIVIDUAL', 'SCENE'] as const;
const AGENT_RULE_LAYERS = ['DNA', 'BEHAVIORAL', 'RELATIONAL', 'CONTEXTUAL'] as const;
const AGENT_RULE_SCOPES = ['SELF', 'DYAD', 'GROUP', 'WORLD'] as const;
const RULE_CATEGORIES = ['CONSTRAINT', 'MECHANISM', 'DEFINITION', 'RELATION', 'POLICY'] as const;
const RULE_HARDNESS = ['HARD', 'FIRM', 'SOFT', 'AESTHETIC'] as const;

type WorldRuleFormState = {
  ruleKey: string;
  title: string;
  statement: string;
  domain: (typeof WORLD_RULE_DOMAINS)[number];
  category: (typeof RULE_CATEGORIES)[number];
  hardness: (typeof RULE_HARDNESS)[number];
  scope: (typeof WORLD_RULE_SCOPES)[number];
  priority: string;
  reasoning: string;
  sourceRef: string;
  dependsOn: string;
  conflictsWith: string;
  overrides: string;
  structuredText: string;
};

type AgentRuleFormState = {
  ruleKey: string;
  title: string;
  statement: string;
  layer: (typeof AGENT_RULE_LAYERS)[number];
  category: (typeof RULE_CATEGORIES)[number];
  hardness: (typeof RULE_HARDNESS)[number];
  scope: (typeof AGENT_RULE_SCOPES)[number];
  priority: string;
  importance: string;
  reasoning: string;
  sourceRef: string;
  dependsOn: string;
  conflictsWith: string;
  worldRuleRef: string;
  structuredText: string;
};

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

function createWorldRuleForm(): WorldRuleFormState {
  return {
    ruleKey: '',
    title: '',
    statement: '',
    domain: 'AXIOM',
    category: 'CONSTRAINT',
    hardness: 'HARD',
    scope: 'WORLD',
    priority: '100',
    reasoning: '',
    sourceRef: '',
    dependsOn: '',
    conflictsWith: '',
    overrides: '',
    structuredText: '',
  };
}

function createAgentRuleForm(): AgentRuleFormState {
  return {
    ruleKey: '',
    title: '',
    statement: '',
    layer: 'DNA',
    category: 'CONSTRAINT',
    hardness: 'HARD',
    scope: 'SELF',
    priority: '100',
    importance: '50',
    reasoning: '',
    sourceRef: '',
    dependsOn: '',
    conflictsWith: '',
    worldRuleRef: '',
    structuredText: '',
  };
}

function parseList(value: string): string[] | undefined {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseStructuredText(value: string): { parsed?: JsonObject; error?: string } {
  const normalized = value.trim();
  if (!normalized) return {};
  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'Structured JSON must be an object.' };
    }
    return { parsed: parsed as JsonObject };
  } catch {
    return { error: 'Structured JSON is invalid.' };
  }
}

function toWorldRuleUpdateForm(rule: WorldRuleDto): WorldRuleFormState {
  return {
    ruleKey: rule.ruleKey,
    title: rule.title,
    statement: rule.statement,
    domain: rule.domain,
    category: rule.category,
    hardness: rule.hardness,
    scope: rule.scope,
    priority: String(rule.priority),
    reasoning: rule.reasoning || '',
    sourceRef: rule.sourceRef || '',
    dependsOn: rule.dependsOn.join(', '),
    conflictsWith: rule.conflictsWith.join(', '),
    overrides: rule.overrides || '',
    structuredText: rule.structured ? JSON.stringify(rule.structured, null, 2) : '',
  };
}

function toAgentRuleUpdateForm(rule: AgentRuleDto): AgentRuleFormState {
  return {
    ruleKey: rule.ruleKey,
    title: rule.title,
    statement: rule.statement,
    layer: rule.layer,
    category: rule.category,
    hardness: rule.hardness,
    scope: rule.scope,
    priority: String(rule.priority),
    importance: String(rule.importance),
    reasoning: rule.reasoning || '',
    sourceRef: rule.sourceRef || '',
    dependsOn: rule.dependsOn.join(', '),
    conflictsWith: rule.conflictsWith.join(', '),
    worldRuleRef: rule.worldRuleRef || '',
    structuredText: rule.structured ? JSON.stringify(rule.structured, null, 2) : '',
  };
}

function buildWorldRulePayload(form: WorldRuleFormState): { payload?: JsonObject; error?: string } {
  const structured = parseStructuredText(form.structuredText);
  if (structured.error) return { error: structured.error };
  const priority = Number(form.priority);
  if (!Number.isInteger(priority)) {
    return { error: 'World rule priority must be an integer.' };
  }
  if (!form.ruleKey.trim() || !form.title.trim() || !form.statement.trim()) {
    return { error: 'World rule key, title, and statement are required.' };
  }
  return {
    payload: {
      ruleKey: form.ruleKey.trim(),
      title: form.title.trim(),
      statement: form.statement.trim(),
      domain: form.domain,
      category: form.category,
      hardness: form.hardness,
      scope: form.scope,
      priority,
      provenance: 'CREATOR',
      reasoning: form.reasoning.trim() || undefined,
      sourceRef: form.sourceRef.trim() || undefined,
      dependsOn: parseList(form.dependsOn),
      conflictsWith: parseList(form.conflictsWith),
      overrides: form.overrides.trim() || undefined,
      structured: structured.parsed,
    },
  };
}

function buildAgentRulePayload(form: AgentRuleFormState): { payload?: JsonObject; error?: string } {
  const structured = parseStructuredText(form.structuredText);
  if (structured.error) return { error: structured.error };
  const priority = Number(form.priority);
  const importance = Number(form.importance);
  if (!Number.isInteger(priority)) {
    return { error: 'Agent rule priority must be an integer.' };
  }
  if (!Number.isFinite(importance) || importance < 0 || importance > 100) {
    return { error: 'Agent rule importance must be between 0 and 100.' };
  }
  if (!form.ruleKey.trim() || !form.title.trim() || !form.statement.trim()) {
    return { error: 'Agent rule key, title, and statement are required.' };
  }
  return {
    payload: {
      ruleKey: form.ruleKey.trim(),
      title: form.title.trim(),
      statement: form.statement.trim(),
      layer: form.layer,
      category: form.category,
      hardness: form.hardness,
      scope: form.scope,
      priority,
      importance,
      provenance: 'CREATOR',
      reasoning: form.reasoning.trim() || undefined,
      sourceRef: form.sourceRef.trim() || undefined,
      dependsOn: parseList(form.dependsOn),
      conflictsWith: parseList(form.conflictsWith),
      worldRuleRef: form.worldRuleRef.trim() || undefined,
      structured: structured.parsed,
    },
  };
}

function formatTimestamp(value: string): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function TruthField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function TruthInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none ${props.className || ''}`.trim()}
    />
  );
}

function TruthSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white focus:border-neutral-500 focus:outline-none ${props.className || ''}`.trim()}
    />
  );
}

function TruthTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none ${props.className || ''}`.trim()}
    />
  );
}

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

function WorldRuleEditor({
  initialForm,
  working,
  onSubmit,
  onCancel,
}: {
  initialForm: WorldRuleFormState;
  working: boolean;
  onSubmit: (value: WorldRuleFormState) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initialForm);

  return (
    <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <TruthField label="Title">
          <TruthInput value={form.title} onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))} />
        </TruthField>
        <TruthField label="Scope">
          <TruthSelect value={form.scope} onChange={(event) => setForm((state) => ({ ...state, scope: event.target.value as WorldRuleFormState['scope'] }))}>
            {WORLD_RULE_SCOPES.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Statement">
          <TruthTextarea rows={3} value={form.statement} onChange={(event) => setForm((state) => ({ ...state, statement: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <TruthField label="Category">
          <TruthSelect value={form.category} onChange={(event) => setForm((state) => ({ ...state, category: event.target.value as WorldRuleFormState['category'] }))}>
            {RULE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
        <TruthField label="Hardness">
          <TruthSelect value={form.hardness} onChange={(event) => setForm((state) => ({ ...state, hardness: event.target.value as WorldRuleFormState['hardness'] }))}>
            {RULE_HARDNESS.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
        <TruthField label="Priority">
          <TruthInput value={form.priority} onChange={(event) => setForm((state) => ({ ...state, priority: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Reasoning">
          <TruthTextarea rows={2} value={form.reasoning} onChange={(event) => setForm((state) => ({ ...state, reasoning: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Structured JSON">
          <TruthTextarea rows={4} value={form.structuredText} onChange={(event) => setForm((state) => ({ ...state, structuredText: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={working}
          onClick={async () => await onSubmit(form)}
          className="rounded-md bg-white px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
        >
          Save Rule
        </button>
        <button
          type="button"
          disabled={working}
          onClick={onCancel}
          className="rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AgentRuleEditor({
  initialForm,
  working,
  onSubmit,
  onCancel,
}: {
  initialForm: AgentRuleFormState;
  working: boolean;
  onSubmit: (value: AgentRuleFormState) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initialForm);

  return (
    <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <TruthField label="Title">
          <TruthInput value={form.title} onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))} />
        </TruthField>
        <TruthField label="Scope">
          <TruthSelect value={form.scope} onChange={(event) => setForm((state) => ({ ...state, scope: event.target.value as AgentRuleFormState['scope'] }))}>
            {AGENT_RULE_SCOPES.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Statement">
          <TruthTextarea rows={3} value={form.statement} onChange={(event) => setForm((state) => ({ ...state, statement: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <TruthField label="Category">
          <TruthSelect value={form.category} onChange={(event) => setForm((state) => ({ ...state, category: event.target.value as AgentRuleFormState['category'] }))}>
            {RULE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
        <TruthField label="Hardness">
          <TruthSelect value={form.hardness} onChange={(event) => setForm((state) => ({ ...state, hardness: event.target.value as AgentRuleFormState['hardness'] }))}>
            {RULE_HARDNESS.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
        <TruthField label="Priority">
          <TruthInput value={form.priority} onChange={(event) => setForm((state) => ({ ...state, priority: event.target.value }))} />
        </TruthField>
        <TruthField label="Importance">
          <TruthInput value={form.importance} onChange={(event) => setForm((state) => ({ ...state, importance: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Reasoning">
          <TruthTextarea rows={2} value={form.reasoning} onChange={(event) => setForm((state) => ({ ...state, reasoning: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Structured JSON">
          <TruthTextarea rows={4} value={form.structuredText} onChange={(event) => setForm((state) => ({ ...state, structuredText: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={working}
          onClick={async () => await onSubmit(form)}
          className="rounded-md bg-white px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
        >
          Save Rule
        </button>
        <button
          type="button"
          disabled={working}
          onClick={onCancel}
          className="rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
