/**
 * Shell product PRESENTATION layer backed by the deterministic State Engine.
 *
 * Reads come from `session.productState()` (the `shell.product` partition —
 * grants, ledger, consent, agent, flow runner state); writes go through the
 * declared `simulator.product.*` commands and the typed cross-app interaction
 * envelopes (`simulator.interaction.emit`). The only shell-local state left
 * is purely visual: ledger drawer open/filter, and the context-bridge packet
 * animation points. Phase 3's in-memory store is gone; on scenario reset the
 * engine reseeds and this provider simply re-reads.
 *
 * Components consume only the `ShellProductPresentation` interface; every
 * surface keeps the simulated labeling required by the Simulator authority.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { JsonValue } from '../../state-engine/json-value.ts';
import {
  simulatorError,
  simulatorFail,
  simulatorOk,
  type SimulatorResult,
} from '../../state-engine/errors.ts';
import type {
  SimulatorProductAgentStatus,
  SimulatorProductFlowDefinition,
  SimulatorProductLedgerKind,
  SimulatorProductLedgerResult,
} from '../../state-engine/product-flows.ts';
import {
  SIMULATOR_PRODUCT_LOCAL_AGENT_CONTEXT_SUMMARY,
  SIMULATOR_PRODUCT_HANDOFF_ROUTE,
} from '../../state-engine/product-flows.ts';
import type { SimulatorShellProductState } from '../../state-engine/product-state.ts';
import { useUi } from './ui-context.tsx';
import { useShellActions } from './shell-actions.tsx';

/* — Public type vocabulary (component-facing; mirrors the engine shapes) — */

export type PresentationAgentStatus = SimulatorProductAgentStatus;
export type PresentationLedgerKind = SimulatorProductLedgerKind;
export type PresentationLedgerResult = SimulatorProductLedgerResult;
export type LedgerFilter = 'all' | 'grant' | 'call' | 'system' | 'uncommitted';

export interface PresentationPersona {
  readonly name: string;
  readonly id: string;
  readonly role: string;
}

export interface PresentationLocalAgent {
  readonly name: string;
  readonly kind: string;
  readonly mode: string;
}

export interface PresentationAgent {
  readonly status: PresentationAgentStatus;
  readonly location: string;
  readonly carry: string | null;
}

export type PresentationGrant = SimulatorShellProductState['grants'][number];
export type PresentationLedgerEntry = SimulatorShellProductState['ledger'][number];

export interface PresentationConsent {
  readonly flowId: string;
  readonly grantId: string;
  readonly origin: string;
}

export interface PresentationBridgePoint {
  readonly x: number;
  readonly y: number;
}

export interface PresentationBridge {
  readonly points: readonly [PresentationBridgePoint, PresentationBridgePoint, PresentationBridgePoint];
  readonly stage: 'toAgent' | 'toTarget';
}

/** Engine ports the provider reads/dispatches through (wired from the
 * session in mount.ts; absent in standalone/SSR composition). */
export interface ProductEnginePorts {
  readonly productState: () => SimulatorShellProductState | null;
  readonly productFlow: (flowId: string) => SimulatorProductFlowDefinition | null;
  readonly dispatchProductCommand: (type: string, payload: JsonValue) => Promise<SimulatorResult<JsonValue>>;
  readonly emitInteraction: (input: {
    readonly type: string;
    readonly sourceModuleId: string;
    readonly sourceInstanceId: string;
    readonly targets: readonly string[];
    readonly payload: JsonValue;
    readonly interactionId: string;
  }) => Promise<SimulatorResult<JsonValue>>;
}

/** Deterministic card copy for the cross-app demo interactions (mirrors the
 * prototype's handoff/carry summary cards). */
const HANDOFF_CARD = Object.freeze({
  title: '交接主题 · 回声谷第三段回声',
  detail: '来自 Desktop 的意图交接：以「回声谷低语回廊」为上下文起稿。路由状态已由系统翻译为应用内主题。',
});

const CARRY_CARD = Object.freeze({
  title: '来自 Runtime LocalAgent · 会话摘要',
  detail: '目标：完成「低语回廊」第三段回声。线索：星港集市的回声商贩。下一步：把谷内地形按声源方位重排，再回星港核对提示。',
});

const FALLBACK_LOCAL_AGENT_PRESENTATION: PresentationLocalAgent = {
  name: 'Nimi',
  kind: 'Realm Character Source LocalAgent',
  mode: 'Runtime Agent Service 执行',
};

const EMPTY_AGENT: PresentationAgent = { status: 'idle', location: 'cradle', carry: null };

/** The presentation-layer public interface. Components must depend only on
 * this shape. */
export interface ShellProductPresentation {
  /** Shared persona; null until Desktop commits the simulated login share. */
  readonly persona: PresentationPersona | null;
  readonly localAgentPresentation: PresentationLocalAgent;
  readonly agent: PresentationAgent;
  readonly grants: readonly PresentationGrant[];
  readonly ledger: readonly PresentationLedgerEntry[];
  readonly consent: PresentationConsent | null;
  readonly bridge: PresentationBridge | null;
  readonly ledgerOpen: boolean;
  readonly ledgerFilter: LedgerFilter;
  readonly flowRunning: boolean;
  readonly flowTitle: (flowId: string) => string | null;
  readonly runFlow: (flowId: string) => void;
  readonly resolveConsent: (accept: boolean) => void;
  readonly toggleGrant: (grantId: string) => void;
  readonly resolveGrant: (grantId: string, accept: boolean) => void;
  readonly toggleLedger: () => void;
  readonly setLedgerFilter: (filter: LedgerFilter) => void;
}

const ProductPresentationContext = createContext<ShellProductPresentation | null>(null);

const STEP_DELAY = 640;
const BRIDGE_DELAY = 780;

export interface FlowDirective {
  readonly name: string;
  readonly moduleId?: string | null;
  readonly text?: string | null;
  readonly title?: string | null;
  readonly detail?: string | null;
  readonly interactionType?: string;
  readonly commandType?: string;
}

function centerOf(el: Element | null, fallback: PresentationBridgePoint): PresentationBridgePoint {
  if (!el) return fallback;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 28) };
}

function asDirective(value: JsonValue): FlowDirective | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, JsonValue>>;
  return typeof record.name === 'string' ? record as unknown as FlowDirective : null;
}

export async function emitPresentationInteraction(input: {
  readonly directive: FlowDirective;
  readonly flowId: string;
  readonly stepIndex: number;
  readonly instances: readonly {
    readonly instanceId: string;
    readonly moduleId: string;
    readonly status: string;
  }[];
  readonly modules: readonly {
    readonly moduleId: string;
    readonly surfaces: readonly { readonly id: string }[];
  }[];
  readonly emitInteraction: ProductEnginePorts['emitInteraction'];
}): Promise<SimulatorResult<JsonValue>> {
  const { directive } = input;
  if (!directive.interactionType || !directive.moduleId || !directive.commandType) {
    return simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
  const origin = input.instances.find(
    (entry) => entry.moduleId === 'desktop' && entry.status !== 'disposed',
  );
  if (!origin) {
    return simulatorFail(simulatorError('SIMULATOR_INSTANCE_DISPOSED', { moduleId: 'desktop' }));
  }

  let payload: JsonValue;
  if (
    directive.interactionType === 'handoff.surface.commit'
    && directive.commandType === 'desktop.handoff.request'
  ) {
    const surface = input.modules.find((module) => module.moduleId === directive.moduleId)?.surfaces[0];
    if (!surface) {
      return simulatorFail(simulatorError('SIMULATOR_UNSUPPORTED', { moduleId: directive.moduleId }));
    }
    payload = {
      targetSurfaceId: surface.id,
      route: SIMULATOR_PRODUCT_HANDOFF_ROUTE as unknown as JsonValue,
      card: HANDOFF_CARD as unknown as JsonValue,
    };
  } else if (
    directive.interactionType === 'local-agent.context.project'
    && directive.commandType === 'desktop.context-projection.request'
  ) {
    payload = {
      carry: SIMULATOR_PRODUCT_LOCAL_AGENT_CONTEXT_SUMMARY,
      card: CARRY_CARD as unknown as JsonValue,
    };
  } else {
    return simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId: 'desktop' }));
  }

  try {
    return await input.emitInteraction({
      type: directive.interactionType,
      sourceModuleId: 'desktop',
      sourceInstanceId: origin.instanceId,
      targets: [directive.moduleId],
      payload,
      interactionId: `${origin.instanceId}:shell-flow:${input.flowId}:${input.stepIndex}`,
    });
  } catch {
    return simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
      moduleId: 'desktop',
      instanceId: origin.instanceId,
    }));
  }
}

export interface PresentationFlowTickOutcome {
  readonly directive: SimulatorResult<JsonValue>;
  readonly progression: SimulatorResult<JsonValue> | null;
  readonly settlement: SimulatorResult<JsonValue>;
}

/**
 * Executes one published flow position. A directive failure never advances
 * the flow: it is converted into a guarded `flow.block` commit. The expected
 * flow id/index carried by both commands prevents a late async result from
 * mutating a reset or replacement flow.
 */
export async function advancePresentationFlow(input: {
  readonly flowId: string;
  readonly stepIndex: number;
  readonly runDirective: () => Promise<SimulatorResult<JsonValue>>;
  readonly dispatchProductCommand: ProductEnginePorts['dispatchProductCommand'];
}): Promise<PresentationFlowTickOutcome> {
  const failed = (code: Parameters<typeof simulatorError>[0]): SimulatorResult<JsonValue> => (
    simulatorFail(simulatorError(code))
  );
  const dispatch = async (type: string, payload: JsonValue): Promise<SimulatorResult<JsonValue>> => {
    try {
      return await input.dispatchProductCommand(type, payload);
    } catch {
      return failed('SIMULATOR_INTEGRITY_FAILURE');
    }
  };
  let directive: SimulatorResult<JsonValue>;
  try {
    directive = await input.runDirective();
  } catch {
    directive = failed('SIMULATOR_INTEGRITY_FAILURE');
  }

  if (!directive.ok) {
    const settlement = await dispatch('simulator.product.flow.block', {
      flowId: input.flowId,
      stepIndex: input.stepIndex,
      errorCode: directive.error.code,
    });
    return { directive, progression: null, settlement };
  }

  const progression = await dispatch('simulator.product.flow.step', {
    flowId: input.flowId,
    stepIndex: input.stepIndex,
  });
  if (progression.ok) return { directive, progression, settlement: progression };

  const settlement = await dispatch('simulator.product.flow.block', {
    flowId: input.flowId,
    stepIndex: input.stepIndex,
    errorCode: progression.error.code,
  });
  return { directive, progression, settlement };
}

export function ProductPresentationProvider({
  ports,
  children,
}: {
  readonly ports?: ProductEnginePorts;
  readonly children: ReactNode;
}) {
  const ui = useUi();
  const actions = useShellActions();
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all');
  const [bridge, setBridge] = useState<PresentationBridge | null>(null);
  const bridgeRef = useRef<PresentationBridge | null>(bridge);
  bridgeRef.current = bridge;

  const product = ports?.productState() ?? null;
  const flow = product?.flow ?? null;

  const latest = useRef({ ui, actions, ports, product });
  latest.current = { ui, actions, ports, product };

  const reportFailure = useCallback((result: SimulatorResult<JsonValue>, label: string) => {
    if (result.ok) return;
    latest.current.ui.showToast({ title: label, detail: result.error.code });
  }, []);

  const focusModule = useCallback((moduleId: string): SimulatorResult<JsonValue> => {
    const { ui: currentUi, actions: currentActions } = latest.current;
    const target = [...currentActions.instances]
      .reverse()
      .find((entry) => entry.moduleId === moduleId && entry.status !== 'disposed');
    if (!target) {
      return simulatorFail(simulatorError('SIMULATOR_INSTANCE_DISPOSED', { moduleId }));
    }
    currentUi.restoreWindow(target.instanceId);
    currentUi.focusWindow(target.instanceId);
    return simulatorOk({ directive: 'focus-app', moduleId });
  }, []);

  const measureBridge = useCallback((): SimulatorResult<PresentationBridge> => {
    const { ui: currentUi, actions: currentActions } = latest.current;
    const firstOf = (moduleId: string) => currentActions.instances
      .find((entry) => entry.moduleId === moduleId && entry.status !== 'disposed');
    const desktop = firstOf('desktop');
    const zhiyu = firstOf('zhiyu');
    if (!desktop) {
      return simulatorFail(simulatorError('SIMULATOR_INSTANCE_DISPOSED', { moduleId: 'desktop' }));
    }
    if (!zhiyu) {
      return simulatorFail(simulatorError('SIMULATOR_INSTANCE_DISPOSED', { moduleId: 'zhiyu' }));
    }
    const source = centerOf(
      currentUi.stageElement(desktop.instanceId),
      { x: window.innerWidth * 0.3, y: window.innerHeight * 0.4 },
    );
    const chip = centerOf(document.querySelector('[data-agent-chip]'), {
      x: window.innerWidth / 2,
      y: 64,
    });
    const target = centerOf(
      currentUi.stageElement(zhiyu.instanceId),
      { x: window.innerWidth * 0.5, y: window.innerHeight * 0.7 },
    );
    return simulatorOk({ points: [source, chip, target], stage: 'toAgent' });
  }, []);

  const dispatchInteraction = useCallback((
    directive: FlowDirective,
    flowId: string,
    stepIndex: number,
  ): Promise<SimulatorResult<JsonValue>> => {
    const { actions: currentActions, ports: currentPorts } = latest.current;
    if (!currentPorts) {
      return Promise.resolve(simulatorFail(simulatorError('SIMULATOR_UNSUPPORTED')));
    }
    return emitPresentationInteraction({
      directive,
      flowId,
      stepIndex,
      instances: currentActions.instances,
      modules: currentActions.modules,
      emitInteraction: currentPorts.emitInteraction,
    });
  }, []);

  const runDirective = useCallback(async (
    directive: FlowDirective,
    flowId: string,
    stepIndex: number,
  ): Promise<SimulatorResult<JsonValue>> => {
    const { ui: currentUi, actions: currentActions } = latest.current;
    switch (directive.name) {
      case 'focus-app':
        return directive.moduleId
          ? focusModule(directive.moduleId)
          : simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
      case 'notice': {
        if (!directive.moduleId) {
          return simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
        }
        const target = currentActions.instances.find(
          (entry) => entry.moduleId === directive.moduleId && entry.status !== 'disposed',
        );
        if (!target) {
          return simulatorFail(simulatorError('SIMULATOR_INSTANCE_DISPOSED', {
            moduleId: directive.moduleId,
          }));
        }
        currentUi.setWindowNotice(directive.moduleId, directive.text ?? null);
        return simulatorOk({ directive: directive.name, moduleId: directive.moduleId });
      }
      case 'toast': {
        if (!directive.title || !directive.detail) {
          return simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
        }
        currentUi.showToast({ title: directive.title, detail: directive.detail });
        return simulatorOk({ directive: directive.name });
      }
      case 'bridge-measure': {
        const measured = measureBridge();
        if (!measured.ok) return simulatorFail(measured.error);
        bridgeRef.current = measured.value;
        setBridge(measured.value);
        return simulatorOk({ directive: directive.name });
      }
      case 'bridge-to-target': {
        const current = bridgeRef.current;
        if (!current) {
          return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE'));
        }
        const next: PresentationBridge = { ...current, stage: 'toTarget' };
        bridgeRef.current = next;
        setBridge(next);
        return simulatorOk({ directive: directive.name });
      }
      case 'bridge-done':
        if (!bridgeRef.current) {
          return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE'));
        }
        bridgeRef.current = null;
        setBridge(null);
        return simulatorOk({ directive: directive.name });
      case 'request-interaction':
        return dispatchInteraction(directive, flowId, stepIndex);
      default:
        return simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
    }
  }, [dispatchInteraction, focusModule, measureBridge]);

  /* — Flow runner —
   * Watches engine flow state instead of assuming. While
   * `flow.status === 'running'`, each tick (640ms, 780ms for bridge
   * directives) awaits the current directive (the step about to be advanced
   * past). Success dispatches a guarded `simulator.product.flow.step`; failure
   * dispatches a guarded `simulator.product.flow.block`. Terminal statuses
   * (completed/blocked/denied/idle) simply stop scheduling. */
  const flowStatus = flow?.status ?? null;
  const flowId = flow?.flowId ?? null;
  const flowStepIndex = flow?.stepIndex ?? 0;
  // Engine truth: `flow.currentDirective` is published for every step,
  // including step 0 (engine commits `stepDirective(flow, 0)` on begin and
  // on consent accept).
  const flowDirective = flow ? asDirective(flow.currentDirective) : null;
  useEffect(() => {
    if (!ports || flowStatus !== 'running' || flowId === null) return undefined;
    const delay = flowDirective?.name.startsWith('bridge') ? BRIDGE_DELAY : STEP_DELAY;
    let active = true;
    const timer = window.setTimeout(() => {
      const currentPorts = latest.current.ports;
      if (!currentPorts) return;
      void advancePresentationFlow({
        flowId,
        stepIndex: flowStepIndex,
        runDirective: () => (
          flowDirective
            ? runDirective(flowDirective, flowId, flowStepIndex)
            : Promise.resolve(simulatorOk({ directive: null }))
        ),
        dispatchProductCommand: currentPorts.dispatchProductCommand,
      }).then((outcome) => {
        if (!active) return;
        reportFailure(outcome.directive, '流程指令失败');
        if (outcome.progression) reportFailure(outcome.progression, '流程推进失败');
        reportFailure(outcome.settlement, '流程失败状态未提交');
      });
    }, delay);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [ports, flowStatus, flowId, flowStepIndex, flowDirective, runDirective, reportFailure]);

  /* Terminal transition notices (blocked/denied) as window notices on the
   * flow's origin module; bridge packet clears whenever the runner stops. */
  const prevFlowStatus = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevFlowStatus.current;
    prevFlowStatus.current = flowStatus;
    if (flowStatus !== 'running') setBridge(null);
    if (prev === flowStatus || flowStatus === null) return;
    const origin = (flowId && ports?.productFlow(flowId)?.origin) || 'desktop';
    if (flowStatus === 'blocked') {
      latest.current.ui.setWindowNotice(origin, '流程已阻断 · 操作未提交');
    } else if (flowStatus === 'denied') {
      latest.current.ui.setWindowNotice(origin, '已拒绝授权 · 操作未提交');
    }
  }, [ports, flowStatus, flowId]);

  const runFlow = useCallback((nextFlowId: string) => {
    const { product: current, ports: currentPorts } = latest.current;
    if (!currentPorts) return;
    const currentFlow = current?.flow ?? null;
    if (current?.consent || (currentFlow && (currentFlow.status === 'running' || currentFlow.status === 'awaiting-consent'))) {
      return;
    }
    void currentPorts.dispatchProductCommand('simulator.product.flow.begin', { flowId: nextFlowId })
      .then((result) => reportFailure(result, '流程未提交'));
  }, [reportFailure]);

  const resolveConsent = useCallback((accept: boolean) => {
    const { ports: currentPorts } = latest.current;
    if (!currentPorts) return;
    void currentPorts.dispatchProductCommand('simulator.product.consent.resolve', { accept })
      .then((result) => reportFailure(result, '授权未提交'));
  }, [reportFailure]);

  const toggleGrant = useCallback((grantId: string) => {
    const { ports: currentPorts } = latest.current;
    if (!currentPorts) return;
    void currentPorts.dispatchProductCommand('simulator.product.grant.toggle', { grantId })
      .then((result) => reportFailure(result, '授权变更未提交'));
  }, [reportFailure]);

  const resolveGrant = useCallback((grantId: string, accept: boolean) => {
    const { ports: currentPorts } = latest.current;
    if (!currentPorts) return;
    void currentPorts.dispatchProductCommand('simulator.product.grant.resolve', { grantId, accept })
      .then((result) => reportFailure(result, '授权处理未提交'));
  }, [reportFailure]);

  const flowTitle = useCallback((nextFlowId: string) => (
    latest.current.ports?.productFlow(nextFlowId)?.title ?? null
  ), []);

  const value = useMemo<ShellProductPresentation>(() => ({
    persona: product?.persona ?? null,
    localAgentPresentation: product?.localAgentPresentation ?? FALLBACK_LOCAL_AGENT_PRESENTATION,
    agent: product?.agent ?? EMPTY_AGENT,
    grants: product?.grants ?? [],
    ledger: product?.ledger ?? [],
    consent: product?.consent ?? null,
    bridge,
    ledgerOpen,
    ledgerFilter,
    flowRunning: flowStatus === 'running' || flowStatus === 'awaiting-consent',
    flowTitle,
    runFlow,
    resolveConsent,
    toggleGrant,
    resolveGrant,
    toggleLedger: () => setLedgerOpen((open) => !open),
    setLedgerFilter,
  }), [
    product,
    bridge,
    ledgerOpen,
    ledgerFilter,
    flowStatus,
    flowTitle,
    runFlow,
    resolveConsent,
    toggleGrant,
    resolveGrant,
  ]);

  return (
    <ProductPresentationContext.Provider value={value}>
      {children}
    </ProductPresentationContext.Provider>
  );
}

export function useProductPresentation(): ShellProductPresentation {
  const ctx = useContext(ProductPresentationContext);
  if (!ctx) throw new Error('useProductPresentation must be used inside ProductPresentationProvider');
  return ctx;
}
