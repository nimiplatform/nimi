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
 * surface keeps the simulated labeling (P-SIM-001).
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
import type { SimulatorResult } from '../../state-engine/errors.ts';
import type {
  SimulatorProductAgentStatus,
  SimulatorProductFlowDefinition,
  SimulatorProductLedgerKind,
  SimulatorProductLedgerResult,
} from '../../state-engine/product-flows.ts';
import {
  SIMULATOR_PRODUCT_CARRY_SUMMARY,
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

export interface PresentationAgentPersona {
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
  title: '来自基座 agent · 会话摘要',
  detail: '目标：完成「低语回廊」第三段回声。线索：星港集市的回声商贩。下一步：把谷内地形按声源方位重排，再回星港核对提示。',
});

const FALLBACK_AGENT_PERSONA: PresentationAgentPersona = {
  name: 'Nimi',
  kind: '基座伴侣 agent',
  mode: '主动模式',
};

const EMPTY_AGENT: PresentationAgent = { status: 'idle', location: 'cradle', carry: null };

/** The presentation-layer public interface. Components must depend only on
 * this shape. */
export interface ShellProductPresentation {
  /** Shared persona; null until Desktop commits the simulated login share. */
  readonly persona: PresentationPersona | null;
  readonly agentPersona: PresentationAgentPersona;
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
  readonly toggleLedger: () => void;
  readonly setLedgerFilter: (filter: LedgerFilter) => void;
}

const ProductPresentationContext = createContext<ShellProductPresentation | null>(null);

const STEP_DELAY = 640;
const BRIDGE_DELAY = 780;

interface FlowDirective {
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

  const product = ports?.productState() ?? null;
  const flow = product?.flow ?? null;

  const latest = useRef({ ui, actions, ports, product });
  latest.current = { ui, actions, ports, product };

  const reportFailure = useCallback((result: SimulatorResult<JsonValue>, label: string) => {
    if (result.ok) return;
    latest.current.ui.showToast({ title: label, detail: result.error.code });
  }, []);

  const focusModule = useCallback((moduleId: string) => {
    const { ui: currentUi, actions: currentActions } = latest.current;
    const target = [...currentActions.instances]
      .reverse()
      .find((entry) => entry.moduleId === moduleId && entry.status !== 'disposed');
    if (!target) return;
    currentUi.restoreWindow(target.instanceId);
    currentUi.focusWindow(target.instanceId);
  }, []);

  const openModule = useCallback((moduleId: string) => {
    const { actions: currentActions } = latest.current;
    const surface = currentActions.modules.find((module) => module.moduleId === moduleId)?.surfaces[0];
    if (surface) currentActions.open(moduleId, surface.id);
  }, []);

  const measureBridge = useCallback((): PresentationBridge => {
    const { ui: currentUi, actions: currentActions } = latest.current;
    const firstOf = (moduleId: string) => currentActions.instances
      .find((entry) => entry.moduleId === moduleId && entry.status !== 'disposed');
    const desktop = firstOf('desktop');
    const zhiyu = firstOf('zhiyu');
    const source = centerOf(
      desktop ? currentUi.stageElement(desktop.instanceId) : null,
      { x: window.innerWidth * 0.3, y: window.innerHeight * 0.4 },
    );
    const chip = centerOf(document.querySelector('[data-agent-chip]'), {
      x: window.innerWidth / 2,
      y: 64,
    });
    const target = centerOf(
      zhiyu ? currentUi.stageElement(zhiyu.instanceId) : null,
      { x: window.innerWidth * 0.5, y: window.innerHeight * 0.7 },
    );
    return { points: [source, chip, target], stage: 'toAgent' };
  }, []);

  const dispatchInteraction = useCallback((directive: FlowDirective, flowId: string, stepIndex: number) => {
    const { ui: currentUi, actions: currentActions, ports: currentPorts } = latest.current;
    if (!currentPorts || !directive.interactionType || !directive.moduleId) return;
    const origin = currentActions.instances.find(
      (entry) => entry.moduleId === 'desktop' && entry.status !== 'disposed',
    );
    if (!origin) {
      currentUi.showToast({
        title: '交接未提交',
        detail: 'SIMULATOR_INSTANCE_DISPOSED — no live desktop origin instance',
      });
      return;
    }
    const payload: JsonValue = directive.commandType === 'desktop.handoff.request'
      ? {
          targetSurfaceId: currentActions.modules.find((module) => module.moduleId === directive.moduleId)
            ?.surfaces[0]?.id ?? 'main',
          route: SIMULATOR_PRODUCT_HANDOFF_ROUTE as unknown as JsonValue,
          card: HANDOFF_CARD as unknown as JsonValue,
        }
      : {
          carry: SIMULATOR_PRODUCT_CARRY_SUMMARY,
          card: CARRY_CARD as unknown as JsonValue,
        };
    void currentPorts.emitInteraction({
      type: directive.interactionType,
      sourceModuleId: 'desktop',
      sourceInstanceId: origin.instanceId,
      targets: [directive.moduleId],
      payload,
      interactionId: `${origin.instanceId}:shell-flow:${flowId}:${stepIndex}`,
    }).then((result) => reportFailure(result, '交接未提交'));
  }, [reportFailure]);

  const runDirective = useCallback((directive: FlowDirective, flowId: string, stepIndex: number) => {
    const { ui: currentUi } = latest.current;
    switch (directive.name) {
      case 'open-app':
        if (directive.moduleId) openModule(directive.moduleId);
        return;
      case 'focus-app':
        if (directive.moduleId) focusModule(directive.moduleId);
        return;
      case 'notice':
        if (directive.moduleId) currentUi.setWindowNotice(directive.moduleId, directive.text ?? null);
        return;
      case 'toast':
        if (directive.title && directive.detail) {
          currentUi.showToast({ title: directive.title, detail: directive.detail });
        }
        return;
      case 'bridge-measure':
        setBridge(measureBridge());
        return;
      case 'bridge-to-target':
        setBridge((current) => (current ? { ...current, stage: 'toTarget' } : current));
        return;
      case 'bridge-done':
        setBridge(null);
        return;
      case 'request-interaction':
        dispatchInteraction(directive, flowId, stepIndex);
        return;
      default:
        return;
    }
  }, [dispatchInteraction, focusModule, measureBridge, openModule]);

  /* — Flow runner —
   * Watches engine flow state instead of assuming. While
   * `flow.status === 'running'`, each tick (640ms, 780ms for bridge
   * directives) animates the current directive (the step about to be
   * advanced past) and then dispatches `simulator.product.flow.step`, whose
   * commit publishes the next directive and the next tick. Terminal statuses
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
    const timer = window.setTimeout(() => {
      if (flowDirective) runDirective(flowDirective, flowId, flowStepIndex);
      void latest.current.ports?.dispatchProductCommand('simulator.product.flow.step', {})
        .then((result) => reportFailure(result, '流程未提交'));
    }, delay);
    return () => window.clearTimeout(timer);
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
      latest.current.ui.setWindowNotice(origin, '授权已撤销 · 操作未提交 (SIMULATOR_UNSUPPORTED)');
    } else if (flowStatus === 'denied') {
      latest.current.ui.setWindowNotice(origin, '已拒绝授权 · 操作未提交');
    }
  }, [ports, flowStatus, flowId]);

  const runFlow = useCallback((nextFlowId: string) => {
    const { product: current, ports: currentPorts, ui: currentUi } = latest.current;
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

  const flowTitle = useCallback((nextFlowId: string) => (
    latest.current.ports?.productFlow(nextFlowId)?.title ?? null
  ), []);

  const value = useMemo<ShellProductPresentation>(() => ({
    persona: product?.persona ?? null,
    agentPersona: product?.agentPersona ?? FALLBACK_AGENT_PERSONA,
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
