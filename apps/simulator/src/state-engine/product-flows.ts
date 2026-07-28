/**
 * Declared Simulator product-flow catalog: the engine-truth step definitions
 * behind the Shell product presentation runner. Data only — every flow is a
 * fixed, deterministic step list consumed by the product-state reducers and
 * by the Shell runner, never an app-specific code branch.
 *
 * Step kinds:
 * - `agent`:    engine commits an agent status/location/carry transition.
 * - `ledger`:   engine appends a closed-union ledger entry.
 * - `directive`: engine records the current directive in flow state; the
 *               Shell runner animates it (open/focus/notice/toast/bridge).
 * - `request`:  engine records the directive; the Shell runner dispatches the
 *               documented origin-module command so the origin instance
 *               emits the typed cross-app interaction.
 */

export type SimulatorProductAgentStatus = 'idle' | 'observing' | 'migrating' | 'acting';
export type SimulatorProductLedgerKind = 'delegation' | 'agent-action' | 'flow' | 'system';
export type SimulatorProductLedgerResult = 'committed' | 'pending' | 'unsupported' | 'denied' | 'info';

export type SimulatorProductFlowStep =
  | {
      readonly type: 'agent';
      readonly status: SimulatorProductAgentStatus;
      readonly location?: string;
      readonly carry?: string | null;
    }
  | {
      readonly type: 'ledger';
      readonly kind: SimulatorProductLedgerKind;
      readonly title: string;
      readonly detail: string;
      readonly actors: readonly string[];
      readonly result: SimulatorProductLedgerResult;
    }
  | {
      readonly type: 'directive';
      readonly name: 'open-app' | 'focus-app' | 'notice' | 'toast' | 'bridge-measure' | 'bridge-to-target' | 'bridge-done';
      readonly moduleId?: string;
      readonly text?: string | null;
      readonly title?: string;
      readonly detail?: string;
    }
  | {
      readonly type: 'request';
      readonly interactionType: 'handoff.surface.commit' | 'local-agent.context.project';
      readonly commandType: 'desktop.handoff.request' | 'desktop.context-projection.request';
      readonly moduleId: string;
    };

export interface SimulatorProductFlowDefinition {
  readonly id: string;
  readonly title: string;
  readonly requiredGrant: string | null;
  readonly consentable: boolean;
  readonly origin: string;
  readonly originLabel: string;
  readonly steps: readonly SimulatorProductFlowStep[];
}

export const SIMULATOR_PRODUCT_GRANT_IDS = [
  'g-world-write',
  'g-presence-read',
  'g-local-agent-context-projection',
] as const;

export const SIMULATOR_PRODUCT_FLOWS: Readonly<Record<string, SimulatorProductFlowDefinition>> = Object.freeze({
  'world.pin': Object.freeze({
    id: 'world.pin',
    title: '足迹共享 · 回声谷',
    requiredGrant: 'g-world-write',
    consentable: false,
    origin: 'desktop',
    originLabel: 'Desktop',
    steps: Object.freeze([
      Object.freeze({ type: 'agent', status: 'acting', location: 'desktop' } as const),
      Object.freeze({
        type: 'ledger',
        kind: 'flow',
        title: '足迹 · 回声谷',
        detail: 'Desktop 经授权向生态共享提交了一条新足迹：重返回声谷，准备第三段回声。',
        actors: ['Desktop', '生态共享'],
        result: 'committed',
      } as const),
      Object.freeze({ type: 'directive', name: 'notice', moduleId: 'tester', text: '世界巡游观察到一条新足迹 · 回声谷' } as const),
      Object.freeze({ type: 'directive', name: 'toast', title: '足迹已提交 · 回声谷', detail: 'Desktop → 生态共享 · Tester 的世界巡游可见' } as const),
      Object.freeze({ type: 'agent', status: 'observing', location: 'desktop' } as const),
    ]),
  }),
  'handoff.zhiyu': Object.freeze({
    id: 'handoff.zhiyu',
    title: '意图交接 · 带入织语',
    requiredGrant: null,
    consentable: false,
    origin: 'desktop',
    originLabel: 'Desktop',
    steps: Object.freeze([
      Object.freeze({ type: 'agent', status: 'acting', location: 'desktop' } as const),
      Object.freeze({
        type: 'request',
        interactionType: 'handoff.surface.commit',
        commandType: 'desktop.handoff.request',
        moduleId: 'zhiyu',
      } as const),
      Object.freeze({ type: 'directive', name: 'focus-app', moduleId: 'zhiyu' } as const),
      Object.freeze({ type: 'directive', name: 'toast', title: '已交接 · 回声谷 → 织语', detail: '意图已翻译为织语的实例路由状态' } as const),
      Object.freeze({ type: 'agent', status: 'observing', location: 'zhiyu' } as const),
    ]),
  }),
  'local-agent.project': Object.freeze({
    id: 'local-agent.project',
    title: 'context 携带 · Nimi → 织语',
    requiredGrant: 'g-local-agent-context-projection',
    consentable: true,
    origin: 'desktop',
    originLabel: 'Desktop',
    steps: Object.freeze([
      Object.freeze({
        type: 'request',
        interactionType: 'local-agent.context.project',
        commandType: 'desktop.context-projection.request',
        moduleId: 'zhiyu',
      } as const),
      Object.freeze({ type: 'agent', status: 'migrating', location: 'desktop', carry: '回声谷解谜计划' } as const),
      Object.freeze({ type: 'directive', name: 'bridge-measure' } as const),
      Object.freeze({ type: 'directive', name: 'bridge-to-target' } as const),
      Object.freeze({ type: 'agent', status: 'acting', location: 'zhiyu', carry: '回声谷解谜计划' } as const),
      Object.freeze({ type: 'directive', name: 'bridge-done' } as const),
      Object.freeze({ type: 'directive', name: 'focus-app', moduleId: 'zhiyu' } as const),
      Object.freeze({ type: 'directive', name: 'toast', title: '摘要已投递 · Nimi → 织语', detail: '只读投影 · 不含任何写权限' } as const),
      Object.freeze({ type: 'agent', status: 'observing', location: 'zhiyu', carry: null } as const),
    ]),
  }),
});

export const SIMULATOR_PRODUCT_FLOW_IDS = Object.freeze(Object.keys(SIMULATOR_PRODUCT_FLOWS));

/** Deterministic carry payload shared by the flow definition and the interaction. */
export const SIMULATOR_PRODUCT_LOCAL_AGENT_CONTEXT_SUMMARY = '回声谷解谜计划' as const;

/** Deterministic route the handoff/carry interactions assign to target surfaces. */
export const SIMULATOR_PRODUCT_HANDOFF_ROUTE = Object.freeze({
  pathname: '/',
  search: Object.freeze([Object.freeze({ key: 'handoff', value: 'sim-intent-handoff' } as const)]),
  fragment: null,
});

export const SIMULATOR_PRODUCT_LOCAL_AGENT_CONTEXT_ROUTE = Object.freeze({
  pathname: '/',
  search: Object.freeze([Object.freeze({ key: 'carry', value: 'sim-local-agent-context-projection' } as const)]),
  fragment: null,
});
