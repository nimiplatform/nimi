/* Scenario type vocabulary for the Nimi OS Simulator prototype.
 *
 * These types mirror — at product level only — the audited design's concepts:
 * modules, surfaces, instances, grants, ledger entries, agent lifecycle.
 * They are NOT the protocol. No State Engine, no real SDK/Kit binding exists
 * here; everything below is deterministic mock content for the demo shell.
 */

export type ModuleId = 'desktop' | 'zhiyu' | 'tester';

export type AgentStatus = 'idle' | 'observing' | 'migrating' | 'acting';

export type AgentLocation = 'cradle' | ModuleId;

export type GrantStatus = 'active' | 'revoked';

export type LedgerKind = 'delegation' | 'agent-action' | 'flow' | 'system';

export type LedgerResult = 'committed' | 'pending' | 'unsupported' | 'denied' | 'info';

export interface Persona {
  name: string;
  id: string;
  role: string;
}

export interface AgentPersona {
  name: string;
  kind: string;
  /** 运行模式, e.g. 主动模式 */
  mode: string;
}

export interface World {
  id: string;
  name: string;
  en: string;
  kind: string;
  presence: string;
  hue: string;
  blurb: string;
}

export interface GrantReceipt {
  /** 权限类型, e.g. 只读 / 写入 */
  access: string;
  /** 作用范围, e.g. 仅当前世界 */
  range: string;
  /** 有效期, e.g. 2 天 */
  validity: string;
  /** expiry detail line under 有效期, e.g. 2025-05-20 10:24 到期; '' when none */
  expiry: string;
  /** 限制, e.g. 不写入长期记忆 */
  restriction: string;
  /** 最近使用, e.g. 2 分钟前 */
  lastUsed: string;
}

export interface Grant {
  id: string;
  title: string;
  scope: string;
  from: string;
  to: string;
  /** freshness line shown under the status badge, e.g. "2 分钟前更新" */
  meta: string;
  /** capability tags shown as chips under the title, e.g. 只读 / 当前世界 */
  tags: string[];
  /** detail rows for the 授权回单 dialog */
  receipt: GrantReceipt;
  status: GrantStatus;
  seeded: boolean;
}

export interface LedgerEntry {
  id: string;
  epoch: number;
  kind: LedgerKind;
  title: string;
  detail: string;
  actors: string[];
  /** extra scope/capability chips shown after the actors, e.g. 当前世界 / 只读 */
  tags?: string[];
  result: LedgerResult;
  at: string;
  history?: boolean;
}

export interface ChatMessage {
  id: string;
  who: 'user' | 'agent' | 'app-ai';
  text: string;
  at: string;
}

export interface ZhiyuCard {
  id: string;
  kind: 'handoff' | 'agent-carry' | 'app-ai';
  title: string;
  body: string;
  origin: string;
}

export interface Footprint {
  worldId: string;
  note: string;
  at: string;
}

export interface Scenario {
  persona: Persona;
  agent: AgentPersona;
  worlds: World[];
  seededGrants: Grant[];
  seededLedger: LedgerEntry[];
  seededChat: ChatMessage[];
  seededFootprints: Footprint[];
  carrySummary: { title: string; body: string };
  openingOpSeq: number;
}
