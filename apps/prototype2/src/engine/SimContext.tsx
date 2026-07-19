/* Mock simulation runtime for the prototype shell.
 *
 * Deliberately NOT a State Engine: one React context, one reducer, a
 * serialized step runner with fixed delays. It exists to make the product
 * layer watchable — deterministic ordering, epoch reset, grant-gated flows,
 * typed unsupported results — without claiming any production semantics.
 * The real build replaces this whole file with the State Engine binding.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { SCENARIO } from '../scenario/scenario';
import { FLOWS, type FlowStep } from '../scenario/flows';
import { edgeDir, groupOf, linkGroups, unlinkGroup, type Rect } from '../shell/weave';
import type {
  AgentLocation,
  AgentStatus,
  ChatMessage,
  Footprint,
  Grant,
  LedgerEntry,
  ModuleId,
  ZhiyuCard,
} from '../scenario/types';

export interface SimWindow {
  instanceId: string;
  moduleId: ModuleId;
  route: string;
  x: number;
  y: number;
  z: number;
  minimized: boolean;
  notice: string | null;
}

interface BridgePoint { x: number; y: number }

export interface BridgeState {
  points: [BridgePoint, BridgePoint, BridgePoint];
  stage: 'toAgent' | 'toTarget';
}

interface ConsentState {
  flowId: string;
  grantId: string;
  origin: ModuleId;
}

interface AgentState {
  status: AgentStatus;
  location: AgentLocation;
  carry: string | null;
}

interface SimState {
  epoch: number;
  opSeq: number;
  instanceSeq: number;
  zTop: number;
  windows: SimWindow[];
  agent: AgentState;
  grants: Grant[];
  ledger: LedgerEntry[];
  footprints: Footprint[];
  desktopChat: ChatMessage[];
  zhiyuCards: ZhiyuCard[];
  consent: ConsentState | null;
  bridge: BridgeState | null;
  ledgerOpen: boolean;
  flowRunning: boolean;
  toast: { title: string; detail: string } | null;
  cradlePos: Record<string, { x: number; y: number; w: number }>;
  weaveGroups: string[][];
}

type Action =
  | { type: 'open-app'; moduleId: ModuleId; route?: string }
  | { type: 'focus'; instanceId: string }
  | { type: 'minimize'; instanceId: string }
  | { type: 'close'; instanceId: string }
  | { type: 'home' }
  | { type: 'move'; instanceId: string; x: number; y: number }
  | { type: 'pane-move'; paneId: string; x: number; y: number }
  | { type: 'weave-eval'; id: string; rects: Record<string, Rect> }
  | { type: 'weave-unlink'; id: string }
  | { type: 'tidy' }
  | { type: 'notice'; moduleId: ModuleId; text: string | null }
  | { type: 'consent-open'; flowId: string; grantId: string; origin: ModuleId }
  | { type: 'consent-resolve'; accept: boolean }
  | { type: 'grant-toggle'; grantId: string }
  | { type: 'ledger-toggle' }
  | { type: 'step'; step: FlowStep }
  | { type: 'bridge-set'; bridge: BridgeState | null }
  | { type: 'bridge-stage'; stage: 'toAgent' | 'toTarget' }
  | { type: 'flow-guard'; running: boolean }
  | { type: 'toast-clear' }
  | { type: 'reset' };

const SPAWN: Record<ModuleId, { x: number; y: number }> = {
  desktop: { x: 150, y: 96 },
  zhiyu: { x: 340, y: 148 },
  tester: { x: 540, y: 208 },
};

export const SPAWN_SIZE: Record<ModuleId, { w: number; h: number }> = {
  desktop: { w: 720, h: 520 },
  zhiyu: { w: 640, h: 500 },
  tester: { w: 600, h: 470 },
};

/** Default constellation for the cradle panes (fractions of the viewport). */
function defaultCradleSpots(): Record<string, { x: number; y: number; w: number }> {
  const w = typeof window === 'undefined' ? 1600 : window.innerWidth;
  const h = typeof window === 'undefined' ? 1000 : window.innerHeight;
  return {
    identity: { x: Math.round(w * 0.06), y: Math.round(h * 0.1), w: 430 },
    agent: { x: Math.round(w * 0.56), y: Math.round(h * 0.12), w: 520 },
    modules: { x: Math.round(w * 0.24), y: Math.round(h * 0.38), w: 620 },
    grants: { x: Math.round(w * 0.66), y: Math.round(h * 0.5), w: 440 },
    worlds: { x: Math.round(w * 0.2), y: Math.round(h * 0.7), w: 840 },
  };
}

export function fmtTime(op: number): string {
  const mm = String(Math.floor(op / 60)).padStart(2, '0');
  const ss = String(op % 60).padStart(2, '0');
  return `T+${mm}:${ss}`;
}

function ledgerId(epoch: number, op: number): string {
  return `${epoch}:op:${String(op).padStart(3, '0')}`;
}

function buildInitialState(epoch: number): SimState {
  return {
    epoch,
    opSeq: SCENARIO.openingOpSeq,
    instanceSeq: 0,
    zTop: 10,
    windows: [],
    agent: { status: 'idle', location: 'cradle', carry: null },
    grants: SCENARIO.seededGrants.map((g) => ({ ...g })),
    ledger: SCENARIO.seededLedger.map((e) => ({ ...e, epoch })),
    footprints: SCENARIO.seededFootprints.map((f) => ({ ...f })),
    desktopChat: SCENARIO.seededChat.map((m) => ({ ...m })),
    zhiyuCards: [],
    consent: null,
    bridge: null,
    ledgerOpen: false,
    flowRunning: false,
    toast: null,
    cradlePos: defaultCradleSpots(),
    weaveGroups: [],
  };
}

function observe(agent: AgentState, location: AgentLocation): AgentState {
  if (agent.status === 'migrating' || agent.status === 'acting') return agent;
  return { status: 'observing', location, carry: agent.carry };
}

function reducer(state: SimState, action: Action): SimState {
  switch (action.type) {
    case 'open-app': {
      const existing = state.windows.find((w) => w.moduleId === action.moduleId);
      if (existing) {
        return {
          ...state,
          zTop: state.zTop + 1,
          windows: state.windows.map((w) =>
            w.instanceId === existing.instanceId
              ? { ...w, minimized: false, z: state.zTop + 1, route: action.route ?? w.route }
              : w,
          ),
          agent: observe(state.agent, action.moduleId),
        };
      }
      const seq = state.instanceSeq + 1;
      const spawn = SPAWN[action.moduleId];
      const cascade = ((seq - 1) % 4) * 26;
      const win: SimWindow = {
        instanceId: `${state.epoch}:instance:${seq}`,
        moduleId: action.moduleId,
        route: action.route ?? '/',
        x: spawn.x + cascade,
        y: spawn.y + cascade,
        z: state.zTop + 1,
        minimized: false,
        notice: null,
      };
      return {
        ...state,
        instanceSeq: seq,
        zTop: state.zTop + 1,
        windows: [...state.windows, win],
        agent: observe(state.agent, action.moduleId),
      };
    }
    case 'focus': {
      const win = state.windows.find((w) => w.instanceId === action.instanceId);
      if (!win) return state;
      const group = groupOf(state.weaveGroups, win.instanceId) ?? [win.instanceId];
      let z = state.zTop;
      const zMap = new Map<string, number>();
      for (const id of group) {
        z += 1;
        zMap.set(id, z);
      }
      return {
        ...state,
        zTop: z,
        windows: state.windows.map((w) =>
          zMap.has(w.instanceId) ? { ...w, minimized: false, z: zMap.get(w.instanceId)! } : w,
        ),
        agent: observe(state.agent, win.moduleId),
      };
    }
    case 'minimize':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.instanceId === action.instanceId ? { ...w, minimized: true } : w,
        ),
      };
    case 'close': {
      const rest = state.windows.filter((w) => w.instanceId !== action.instanceId);
      const anyVisible = rest.some((w) => !w.minimized);
      return {
        ...state,
        windows: rest,
        weaveGroups: unlinkGroup(state.weaveGroups, action.instanceId),
        agent: anyVisible ? state.agent : { status: 'idle', location: 'cradle', carry: state.agent.carry },
      };
    }
    case 'home':
      return {
        ...state,
        windows: state.windows.map((w) => ({ ...w, minimized: true })),
        agent:
          state.agent.status === 'migrating' || state.agent.status === 'acting'
            ? state.agent
            : { status: 'idle', location: 'cradle', carry: state.agent.carry },
      };
    case 'move': {
      const group = groupOf(state.weaveGroups, action.instanceId);
      const dragged = state.windows.find((w) => w.instanceId === action.instanceId);
      if (!dragged) return state;
      if (!group) {
        return {
          ...state,
          windows: state.windows.map((w) =>
            w.instanceId === action.instanceId ? { ...w, x: action.x, y: action.y } : w,
          ),
        };
      }
      const dx = action.x - dragged.x;
      const dy = action.y - dragged.y;
      const cradlePos = { ...state.cradlePos };
      for (const id of group) {
        if (cradlePos[id]) {
          cradlePos[id] = { ...cradlePos[id], x: cradlePos[id].x + dx, y: cradlePos[id].y + dy };
        }
      }
      return {
        ...state,
        cradlePos,
        windows: state.windows.map((w) =>
          group.includes(w.instanceId) ? { ...w, x: w.x + dx, y: w.y + dy } : w,
        ),
      };
    }
    case 'pane-move': {
      const spot = state.cradlePos[action.paneId];
      if (!spot) return state;
      const group = groupOf(state.weaveGroups, action.paneId);
      if (!group) {
        return {
          ...state,
          cradlePos: { ...state.cradlePos, [action.paneId]: { ...spot, x: action.x, y: action.y } },
        };
      }
      const dx = action.x - spot.x;
      const dy = action.y - spot.y;
      const cradlePos = { ...state.cradlePos };
      for (const id of group) {
        if (cradlePos[id]) {
          cradlePos[id] = { ...cradlePos[id], x: cradlePos[id].x + dx, y: cradlePos[id].y + dy };
        }
      }
      return {
        ...state,
        cradlePos,
        windows: state.windows.map((w) =>
          group.includes(w.instanceId) ? { ...w, x: w.x + dx, y: w.y + dy } : w,
        ),
      };
    }
    case 'weave-eval': {
      const rect = action.rects[action.id];
      if (!rect) return state;
      const found = Object.entries(action.rects).find(
        ([otherId, other]) => otherId !== action.id && edgeDir(rect, other) !== null,
      );
      if (!found) return state;
      const [targetId, targetRect] = found;
      const dir = edgeDir(rect, targetRect)!;
      const weaveGroups = linkGroups(state.weaveGroups, action.id, targetId);

      // snap the dragged pane flush against the weave target
      const gap = 8;
      let nx: number | null = null;
      let ny: number | null = null;
      if (dir === 'right') {
        nx = targetRect.x - rect.w - gap;
        ny = targetRect.y;
      } else if (dir === 'left') {
        nx = targetRect.x + targetRect.w + gap;
        ny = targetRect.y;
      } else if (dir === 'bottom') {
        nx = targetRect.x;
        ny = targetRect.y - rect.h - gap;
      } else {
        nx = targetRect.x;
        ny = targetRect.y + targetRect.h + gap;
      }
      nx = Math.min(Math.max(nx, 8), window.innerWidth - 160);
      ny = Math.min(Math.max(ny, 16), window.innerHeight - 120);

      const win = state.windows.find((w) => w.instanceId === action.id);
      if (win) {
        return {
          ...state,
          weaveGroups,
          windows: state.windows.map((w) =>
            w.instanceId === action.id ? { ...w, x: nx!, y: ny! } : w,
          ),
        };
      }
      const spot = state.cradlePos[action.id];
      if (spot) {
        return {
          ...state,
          weaveGroups,
          cradlePos: { ...state.cradlePos, [action.id]: { ...spot, x: nx, y: ny } },
        };
      }
      return { ...state, weaveGroups };
    }
    case 'weave-unlink':
      return { ...state, weaveGroups: unlinkGroup(state.weaveGroups, action.id) };
    case 'tidy': {
      let i = 0;
      return {
        ...state,
        cradlePos: defaultCradleSpots(),
        weaveGroups: [],
        windows: state.windows.map((w) => {
          if (w.minimized) return w;
          i += 1;
          return { ...w, x: 120 + i * 48, y: 80 + i * 42 };
        }),
      };
    }
    case 'notice':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.moduleId === action.moduleId ? { ...w, notice: action.text } : w,
        ),
      };
    case 'consent-open':
      return { ...state, consent: { flowId: action.flowId, grantId: action.grantId, origin: action.origin } };
    case 'consent-resolve':
      return { ...state, consent: null };
    case 'grant-toggle': {
      const op = state.opSeq + 1;
      const grant = state.grants.find((g) => g.id === action.grantId);
      if (!grant) return state;
      const next = grant.status === 'active' ? 'revoked' : 'active';
      const entry: LedgerEntry = {
        id: ledgerId(state.epoch, op),
        epoch: state.epoch,
        kind: 'delegation',
        title: next === 'revoked' ? `撤销授权 · ${grant.title}` : `重新授权 · ${grant.title}`,
        detail:
          next === 'revoked'
            ? `你在基座撤销了「${grant.title}」。依赖它的后续操作将返回稳定的 typed unsupported，且不提交任何状态。`
            : `你在基座重新授权了「${grant.title}」。`,
        actors: ['林澈', grant.from],
        result: next === 'revoked' ? 'info' : 'committed',
        at: fmtTime(op),
      };
      return {
        ...state,
        opSeq: op,
        grants: state.grants.map((g) => (g.id === action.grantId ? { ...g, status: next } : g)),
        ledger: [...state.ledger, entry],
      };
    }
    case 'ledger-toggle':
      return { ...state, ledgerOpen: !state.ledgerOpen };
    case 'step': {
      const step = action.step;
      switch (step.type) {
        case 'agent':
          return {
            ...state,
            agent: {
              status: step.status,
              location: step.location ?? state.agent.location,
              carry: step.carry !== undefined ? step.carry : state.agent.carry,
            },
          };
        case 'ledger': {
          const op = state.opSeq + 1;
          const entry: LedgerEntry = {
            id: ledgerId(state.epoch, op),
            epoch: state.epoch,
            kind: step.kind,
            title: step.title,
            detail: step.detail,
            actors: step.actors,
            result: step.result,
            at: fmtTime(op),
          };
          return { ...state, opSeq: op, ledger: [...state.ledger, entry] };
        }
        case 'footprint': {
          const fp: Footprint = { worldId: step.worldId, note: step.note, at: fmtTime(state.opSeq) };
          return { ...state, footprints: [...state.footprints, fp] };
        }
        case 'open-app':
          return reducer(state, { type: 'open-app', moduleId: step.moduleId, route: step.route });
        case 'focus-app': {
          const win = state.windows.find((w) => w.moduleId === step.moduleId);
          return win ? reducer(state, { type: 'focus', instanceId: win.instanceId }) : state;
        }
        case 'notice':
          return reducer(state, { type: 'notice', moduleId: step.moduleId, text: step.text });
        case 'zhiyu-card': {
          const card: ZhiyuCard =
            step.card.kind === 'agent-carry'
              ? { ...step.card, title: SCENARIO.carrySummary.title, body: SCENARIO.carrySummary.body }
              : step.card;
          if (state.zhiyuCards.some((c) => c.id === card.id)) return state;
          return { ...state, zhiyuCards: [...state.zhiyuCards, card] };
        }
        case 'desktop-msg': {
          const msg: ChatMessage = {
            id: `m-${state.opSeq}`,
            who: 'agent',
            text: step.text,
            at: fmtTime(state.opSeq),
          };
          return { ...state, desktopChat: [...state.desktopChat, msg] };
        }
        case 'toast':
          return { ...state, toast: { title: step.title, detail: step.detail } };
        case 'bridge':
          return state; // handled by the runner (DOM measuring), not the reducer
      }
      return state;
    }
    case 'bridge-set':
      return { ...state, bridge: action.bridge };
    case 'bridge-stage':
      return state.bridge ? { ...state, bridge: { ...state.bridge, stage: action.stage } } : state;
    case 'flow-guard':
      return { ...state, flowRunning: action.running };
    case 'toast-clear':
      return { ...state, toast: null };
    case 'reset':
      return buildInitialState(state.epoch + 1);
    default:
      return state;
  }
}

interface SimApi {
  state: SimState;
  openApp: (moduleId: ModuleId, route?: string) => void;
  focusWindow: (instanceId: string) => void;
  minimizeWindow: (instanceId: string) => void;
  closeWindow: (instanceId: string) => void;
  moveWindow: (instanceId: string, x: number, y: number) => void;
  movePane: (paneId: string, x: number, y: number) => void;
  weaveEval: (id: string, rects: Record<string, Rect>) => void;
  weaveUnlink: (id: string) => void;
  tidy: () => void;
  goHome: () => void;
  runFlow: (flowId: string) => void;
  resolveConsent: (accept: boolean) => void;
  toggleGrant: (grantId: string) => void;
  toggleLedger: () => void;
  dismissToast: () => void;
  resetSession: () => void;
}

const SimContext = createContext<SimApi | null>(null);

const STEP_DELAY = 640;
const BRIDGE_DELAY = 780;

function centerOf(el: Element | null, fallback: BridgePoint): BridgePoint {
  if (!el) return fallback;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 28) };
}

export function SimProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, 1, buildInitialState);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const executeSteps = useCallback(
    (flowId: string) => {
      const flow = FLOWS[flowId];
      dispatch({ type: 'flow-guard', running: true });
      let acc = 0;
      flow.steps.forEach((step) => {
        const isBridge = step.type === 'bridge';
        acc += isBridge ? BRIDGE_DELAY : STEP_DELAY;
        const t = window.setTimeout(() => {
          if (step.type === 'bridge') {
            if (step.phase === 'measure') {
              const source = centerOf(
                document.querySelector('[data-instance-module="desktop"]'),
                { x: window.innerWidth * 0.3, y: window.innerHeight * 0.4 },
              );
              const chip = centerOf(document.querySelector('[data-agent-chip]'), {
                x: window.innerWidth / 2,
                y: 64,
              });
              const spawn = SPAWN.zhiyu;
              const target = centerOf(document.querySelector('[data-instance-module="zhiyu"]'), {
                x: spawn.x + SPAWN_SIZE.zhiyu.w / 2,
                y: spawn.y + 28,
              });
              dispatch({ type: 'bridge-set', bridge: { points: [source, chip, target], stage: 'toAgent' } });
            } else if (step.phase === 'to-target') {
              dispatch({ type: 'bridge-stage', stage: 'toTarget' });
            } else {
              dispatch({ type: 'bridge-set', bridge: null });
            }
            return;
          }
          dispatch({ type: 'step', step });
        }, acc);
        timers.current.push(t);
      });
      const done = window.setTimeout(
        () => dispatch({ type: 'flow-guard', running: false }),
        acc + STEP_DELAY,
      );
      timers.current.push(done);
    },
    [],
  );

  const runFlow = useCallback(
    (flowId: string) => {
      if (state.flowRunning || state.consent) return;
      const flow = FLOWS[flowId];
      if (!flow) return;
      const grant = flow.requiredGrant ? state.grants.find((g) => g.id === flow.requiredGrant) : null;
      if (grant && grant.status !== 'active') {
        if (flow.consentable) {
          dispatch({ type: 'consent-open', flowId, grantId: grant.id, origin: flow.origin });
        } else {
          dispatch({
            type: 'step',
            step: {
              type: 'ledger',
              kind: 'flow',
              title: `${flow.title} · 未提交`,
              detail: `授权「${grant.title}」已被撤销。操作返回稳定的 typed unsupported，未提交任何状态。`,
              actors: ['Desktop', '生态共享'],
              result: 'unsupported',
            },
          });
          dispatch({ type: 'notice', moduleId: flow.origin, text: '授权已撤销 · 操作未提交 (SIMULATOR_UNSUPPORTED)' });
        }
        return;
      }
      executeSteps(flowId);
    },
    [state.flowRunning, state.consent, state.grants, executeSteps],
  );

  const resolveConsent = useCallback(
    (accept: boolean) => {
      const pending = state.consent;
      if (!pending) return;
      dispatch({ type: 'consent-resolve', accept });
      if (!accept) {
        dispatch({
          type: 'step',
          step: {
            type: 'ledger',
            kind: 'delegation',
            title: '授权被拒绝 · context 携带',
            detail: '你拒绝了本次系统级授权请求。未提交任何状态，目标应用未收到内容。',
            actors: ['林澈', 'Nimi'],
            result: 'denied',
          },
        });
        dispatch({ type: 'notice', moduleId: pending.origin, text: '已拒绝授权 · 操作未提交' });
        return;
      }
      dispatch({ type: 'grant-toggle', grantId: pending.grantId });
      const timer = window.setTimeout(() => executeSteps(pending.flowId), 120);
      timers.current.push(timer);
    },
    [state.consent, executeSteps],
  );

  const api = useMemo<SimApi>(
    () => ({
      state,
      openApp: (moduleId, route) => dispatch({ type: 'open-app', moduleId, route }),
      focusWindow: (instanceId) => dispatch({ type: 'focus', instanceId }),
      minimizeWindow: (instanceId) => dispatch({ type: 'minimize', instanceId }),
      closeWindow: (instanceId) => dispatch({ type: 'close', instanceId }),
      moveWindow: (instanceId, x, y) => dispatch({ type: 'move', instanceId, x, y }),
      movePane: (paneId, x, y) => dispatch({ type: 'pane-move', paneId, x, y }),
      weaveEval: (id, rects) => dispatch({ type: 'weave-eval', id, rects }),
      weaveUnlink: (id) => dispatch({ type: 'weave-unlink', id }),
      tidy: () => dispatch({ type: 'tidy' }),
      goHome: () => dispatch({ type: 'home' }),
      runFlow,
      resolveConsent,
      toggleGrant: (grantId) => dispatch({ type: 'grant-toggle', grantId }),
      toggleLedger: () => dispatch({ type: 'ledger-toggle' }),
      dismissToast: () => dispatch({ type: 'toast-clear' }),
      resetSession: () => {
        clearTimers();
        dispatch({ type: 'reset' });
      },
    }),
    [state, runFlow, resolveConsent, clearTimers],
  );

  return <SimContext.Provider value={api}>{children}</SimContext.Provider>;
}

export function useSim(): SimApi {
  const ctx = useContext(SimContext);
  if (!ctx) throw new Error('useSim must be used inside SimProvider');
  return ctx;
}
