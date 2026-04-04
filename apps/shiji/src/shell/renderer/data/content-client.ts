import { getPlatformClient } from '@nimiplatform/sdk';
import type { RealmServiceResult } from '@nimiplatform/sdk/realm';

type WorldRulesResult = RealmServiceResult<'WorldRulesService', 'worldRulesControllerGetRules'>;
type WorldRuleDto = WorldRulesResult extends (infer T)[] ? T : never;
type AgentRulesResult = RealmServiceResult<'AgentRulesService', 'agentRulesControllerListRules'>;
type AgentRuleDto = AgentRulesResult extends (infer T)[] ? T : never;
type LorebooksResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorldLorebooks'>;
type LorebookDto = LorebooksResult extends (infer T)[] ? T : never;

export type WorldRuleRecord = {
  id: string;
  ruleKey: string;
  title: string;
  statement: string;
};

export type AgentRuleRecord = {
  id: string;
  agentId: string;
  ruleKey: string;
  title: string;
  statement: string;
};

export type LorebookRecord = {
  id: string;
  title: string;
  key: string;
  content: string;
};

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: expected object`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: expected array`);
  }
  return value;
}

function expectString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}.${key}: expected non-empty string`);
  }
  return value.trim();
}

function parseWorldRule(raw: unknown): WorldRuleRecord {
  const record = expectObject(raw, 'world_rule');
  return {
    id: expectString(record, 'id', 'world_rule'),
    ruleKey: expectString(record, 'ruleKey', 'world_rule'),
    title: expectString(record, 'title', 'world_rule'),
    statement: expectString(record, 'statement', 'world_rule'),
  };
}

function parseAgentRule(raw: unknown): AgentRuleRecord {
  const record = expectObject(raw, 'agent_rule');
  return {
    id: expectString(record, 'id', 'agent_rule'),
    agentId: expectString(record, 'agentId', 'agent_rule'),
    ruleKey: expectString(record, 'ruleKey', 'agent_rule'),
    title: expectString(record, 'title', 'agent_rule'),
    statement: expectString(record, 'statement', 'agent_rule'),
  };
}

function parseLorebook(raw: unknown): LorebookRecord {
  const record = expectObject(raw, 'lorebook');
  return {
    id: expectString(record, 'id', 'lorebook'),
    title: expectString(record, 'title', 'lorebook'),
    key: expectString(record, 'key', 'lorebook'),
    content: expectString(record, 'content', 'lorebook'),
  };
}

function parseList<T>(value: unknown, label: string, parseItem: (item: unknown) => T): T[] {
  return expectArray(value, label).map((item) => parseItem(item));
}

export async function getWorldRules(worldId: string): Promise<WorldRuleRecord[]> {
  const result = await getPlatformClient().realm.services.WorldRulesService.worldRulesControllerGetRules(worldId);
  const rules = parseList(result as WorldRuleDto[], 'world_rules', parseWorldRule);
  if (rules.length === 0) {
    throw new Error(`world_rules: expected at least one rule for world ${worldId}`);
  }
  return rules;
}

export async function getAgentRules(worldId: string, agentId: string): Promise<AgentRuleRecord[]> {
  const result = await getPlatformClient().realm.services.AgentRulesService.agentRulesControllerListRules(worldId, agentId);
  const rules = parseList(result as AgentRuleDto[], 'agent_rules', parseAgentRule);
  if (rules.length === 0) {
    throw new Error(`agent_rules: expected at least one rule for world ${worldId} agent ${agentId}`);
  }
  return rules;
}

export async function getLorebooks(worldId: string): Promise<LorebookRecord[]> {
  const result = await getPlatformClient().realm.services.WorldsService.worldControllerGetWorldLorebooks(worldId);
  const normalized = Array.isArray(result)
    ? result
    : expectObject(result, 'lorebooks_response')['items'];
  return parseList(normalized as unknown, 'lorebooks', parseLorebook);
}
