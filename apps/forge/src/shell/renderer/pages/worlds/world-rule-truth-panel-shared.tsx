import type { RealmModel } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@renderer/bridge/types.js';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

type AgentRuleDto = RealmModel<'AgentRuleDto'>;
type WorldRuleDto = RealmModel<'WorldRuleDto'>;

export const WORLD_RULE_DOMAINS = ['AXIOM', 'PHYSICS', 'SOCIETY', 'ECONOMY', 'CHARACTER', 'NARRATIVE', 'META'] as const;
export const WORLD_RULE_SCOPES = ['WORLD', 'REGION', 'FACTION', 'INDIVIDUAL', 'SCENE'] as const;
export const AGENT_RULE_LAYERS = ['DNA', 'BEHAVIORAL', 'RELATIONAL', 'CONTEXTUAL'] as const;
export const AGENT_RULE_SCOPES = ['SELF', 'DYAD', 'GROUP', 'WORLD'] as const;
export const RULE_CATEGORIES = ['CONSTRAINT', 'MECHANISM', 'DEFINITION', 'RELATION', 'POLICY'] as const;
export const RULE_HARDNESS = ['HARD', 'FIRM', 'SOFT', 'AESTHETIC'] as const;

export type WorldRuleFormState = {
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

export type AgentRuleFormState = {
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

export function createWorldRuleForm(): WorldRuleFormState {
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

export function createAgentRuleForm(): AgentRuleFormState {
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

export function toWorldRuleUpdateForm(rule: WorldRuleDto): WorldRuleFormState {
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

export function toAgentRuleUpdateForm(rule: AgentRuleDto): AgentRuleFormState {
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

export function buildWorldRulePayload(form: WorldRuleFormState): { payload?: JsonObject; error?: string } {
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

export function buildAgentRulePayload(form: AgentRuleFormState): { payload?: JsonObject; error?: string } {
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

export function formatTimestamp(value: string): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function TruthField({
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

export function TruthInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none ${props.className || ''}`.trim()}
    />
  );
}

export function TruthSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white focus:border-neutral-500 focus:outline-none ${props.className || ''}`.trim()}
    />
  );
}

export function TruthTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none ${props.className || ''}`.trim()}
    />
  );
}
