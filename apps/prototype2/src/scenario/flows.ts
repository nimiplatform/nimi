/* Canonical cross-App flows (product-level mock).
 *
 * These mirror the three interaction classes from the design discussion:
 *   1. data sharing   — Desktop writes a shared footprint; Lab observes it
 *   2. intent handoff — a world is carried into Zhiyu as a new route/topic
 *   3. Runtime-mediated — one LocalAgent context is projected across apps
 *
 * Steps are declarative and run in a fixed order with fixed delays. The real
 * build replaces this runner with the deterministic State Engine; nothing
 * here asserts production semantics.
 */

import type { AgentLocation, AgentStatus, LedgerKind, LedgerResult, ModuleId, ZhiyuCard } from './types';

export type FlowStep =
  | { type: 'agent'; status: AgentStatus; location?: AgentLocation; carry?: string | null }
  | { type: 'ledger'; kind: LedgerKind; title: string; detail: string; actors: string[]; result: LedgerResult }
  | { type: 'footprint'; worldId: string; note: string }
  | { type: 'open-app'; moduleId: ModuleId; route?: string }
  | { type: 'focus-app'; moduleId: ModuleId }
  | { type: 'notice'; moduleId: ModuleId; text: string | null }
  | { type: 'zhiyu-card'; card: ZhiyuCard }
  | { type: 'bridge'; phase: 'measure' | 'to-target' | 'done' }
  | { type: 'toast'; title: string; detail: string }
  | { type: 'desktop-msg'; text: string; at?: string };

export interface FlowDef {
  id: string;
  title: string;
  /** grant that must be active for the flow to commit */
  requiredGrant: string | null;
  /** when true, a missing/revoked grant opens the system consent card instead
   * of producing a typed unsupported result */
  consentable: boolean;
  origin: ModuleId;
  steps: FlowStep[];
}

export const FLOWS: Record<string, FlowDef> = {
  'world.pin': {
    id: 'world.pin',
    title: '足迹共享 · 回声谷',
    requiredGrant: 'g-world-write',
    consentable: false,
    origin: 'desktop',
    steps: [
      {
        type: 'agent', status: 'acting', location: 'desktop',
      },
      {
        type: 'ledger',
        kind: 'flow',
        title: '足迹 · 回声谷',
        detail: 'Desktop 经授权向生态共享提交了一条新足迹：重返回声谷，准备第三段回声。',
        actors: ['Desktop', '生态共享'],
        result: 'committed',
      },
      { type: 'footprint', worldId: 'echo-vale', note: '重返回声谷 · 准备第三段回声' },
      {
        type: 'notice',
        moduleId: 'lab',
        text: '世界巡游观察到一条新足迹 · 回声谷',
      },
      {
        type: 'toast',
        title: '足迹已提交 · 回声谷',
        detail: 'Desktop → 生态共享 · Lab 的世界巡游可见',
      },
      {
        type: 'agent', status: 'observing', location: 'desktop',
      },
    ],
  },

  'handoff.zhiyu': {
    id: 'handoff.zhiyu',
    title: '意图交接 · 带入织羽',
    requiredGrant: null,
    consentable: false,
    origin: 'desktop',
    steps: [
      {
        type: 'agent', status: 'acting', location: 'desktop',
      },
      { type: 'open-app', moduleId: 'zhiyu', route: '/continue/echo-vale' },
      {
        type: 'zhiyu-card',
        card: {
          id: 'zh-handoff',
          kind: 'handoff',
          title: '交接主题 · 回声谷第三段回声',
          body: '来自 Desktop 的意图交接：以「回声谷低语回廊」为上下文起稿。路由状态 /continue/echo-vale 已由系统翻译为应用内主题。',
          origin: 'Desktop → Zhiyu',
        },
      },
      {
        type: 'ledger',
        kind: 'flow',
        title: '意图交接 · Desktop → Zhiyu',
        detail: '「在织羽中继续」被翻译为 Zhiyu 的实例路由状态；未发生应用间私有调用。',
        actors: ['Desktop', 'Zhiyu'],
        result: 'committed',
      },
      { type: 'focus-app', moduleId: 'zhiyu' },
      {
        type: 'toast',
        title: '已交接 · 回声谷 → 织羽',
        detail: '意图已翻译为织羽的实例路由状态',
      },
      {
        type: 'agent', status: 'observing', location: 'zhiyu',
      },
    ],
  },

  'local-agent.project': {
    id: 'local-agent.project',
    title: 'context 携带 · Nimi → 织羽',
    requiredGrant: 'g-local-agent-context-projection',
    consentable: true,
    origin: 'desktop',
    steps: [
      {
        type: 'ledger',
        kind: 'delegation',
        title: '委托 · 携带会话摘要',
        detail: '你授权 Runtime Agent Service 将 Nimi 的本次 Desktop 会话摘要投影到 Zhiyu。',
        actors: ['林澈', 'Nimi'],
        result: 'committed',
      },
      {
        type: 'agent', status: 'migrating', location: 'desktop', carry: '回声谷解谜计划',
      },
      { type: 'bridge', phase: 'measure' },
      { type: 'bridge', phase: 'to-target' },
      { type: 'open-app', moduleId: 'zhiyu', route: '/inbox/nimi' },
      {
        type: 'agent', status: 'acting', location: 'zhiyu', carry: '回声谷解谜计划',
      },
      {
        type: 'zhiyu-card',
        card: {
          id: 'zh-carry',
          kind: 'local-agent-projection',
          title: '来自 Runtime LocalAgent · 会话摘要',
          body: '', // filled from scenario.carrySummary at execution time
          origin: 'Nimi · 经系统级授权携带',
        },
      },
      {
        type: 'ledger',
        kind: 'agent-action',
        title: 'Runtime Agent Service 行动 · 摘要投影',
        detail: 'Nimi 将只读摘要投影投递到 Zhiyu 实例。投递内容不含任何写权限。',
        actors: ['Nimi', 'Zhiyu'],
        result: 'committed',
      },
      { type: 'bridge', phase: 'done' },
      { type: 'focus-app', moduleId: 'zhiyu' },
      {
        type: 'toast',
        title: '摘要已投递 · Nimi → 织羽',
        detail: '只读投影 · 不含任何写权限',
      },
      {
        type: 'agent', status: 'observing', location: 'zhiyu', carry: null,
      },
    ],
  },
};
