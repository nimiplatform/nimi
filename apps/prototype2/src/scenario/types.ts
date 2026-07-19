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

export type LedgerResult = 'committed' | 'unsupported' | 'denied' | 'info';

export interface Persona {
  name: string;
  id: string;
  role: string;
}

export interface AgentPersona {
  name: string;
  kind: string;
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

export interface Grant {
  id: string;
  title: string;
  scope: string;
  from: string;
  to: string;
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
