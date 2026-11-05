import type { HeroDemoSurface } from './landing-content.js';
import { demoChapters, demoSectionIds } from './demo-tour.js';

export type DemoDestination = {
  surface: HeroDemoSurface;
  target?: string;
  view?: 'draft' | 'access';
};
export type PreviewScreen = 'home' | 'journal' | 'keepsakes' | 'companion' | 'memory';
export type PreviewDestination = { appId: string; screen: PreviewScreen; partnerId?: string };
export type DemoNavigation = {
  entries: readonly DemoDestination[];
  position: number;
  section?: number;
  guide?: { step: number; exploring: boolean };
  preview?: PreviewDestination & { guided: boolean };
  homeRevision?: number;
};
export type DemoNavigationAction =
  | { type: 'push' | 'replace' | 'reset'; destination: DemoDestination }
  | { type: 'go'; delta: -1 | 1 }
  | { type: 'enter-section'; index: number }
  | { type: 'guide'; step: number }
  | { type: 'explore' }
  | { type: 'open-preview'; appId: string; screen?: PreviewScreen; partnerId?: string }
  | { type: 'close-preview' };

export function initialDemoSection(hash: string) {
  return Math.max(0, demoSectionIds.indexOf(hash.slice(1)));
}

function sameDestination(a: DemoDestination, b: DemoDestination) {
  return a.surface === b.surface && a.target === b.target && a.view === b.view;
}

function move(state: DemoNavigation, destination: DemoDestination, replace: boolean): DemoNavigation {
  if (sameDestination(state.entries[state.position]!, destination)) return state;
  if (replace) return { ...state, entries: state.entries.map((entry, i) => i === state.position ? destination : entry) };
  return { ...state, entries: [...state.entries.slice(0, state.position + 1), destination], position: state.position + 1 };
}

function showStep(state: DemoNavigation, step: number, replace: boolean): DemoNavigation {
  const stop = demoChapters[(state.section ?? 0) - 2]?.stops[step];
  if (!stop) return state;
  return move({
    ...state,
    guide: { step, exploring: false },
    // Re-enter the scripted Home page even when exploration only changed a local tab.
    homeRevision: state.guide?.exploring ? (state.homeRevision ?? 0) + 1 : state.homeRevision,
    preview: stop.preview ? { ...stop.preview, guided: true } : undefined,
  }, stop.destination, replace);
}

export function reduceDemoNavigation(state: DemoNavigation, action: DemoNavigationAction): DemoNavigation {
  if (action.type === 'enter-section') {
    if (state.section === action.index) return state;
    const next = { ...state, section: action.index, guide: undefined, preview: undefined };
    if (demoChapters[action.index - 2]) return showStep(next, 0, true);
    return action.index === 0 || action.index === 1
      ? move(next, { surface: action.index === 0 ? 'home' : 'chat' }, true)
      : next;
  }
  if (action.type === 'guide') return showStep(state, action.step, false);

  const free = state.guide && !state.guide.exploring
    ? { ...state, guide: { ...state.guide, exploring: true } }
    : state;
  if (action.type === 'explore') return free;
  if (action.type === 'open-preview') {
    return { ...free, preview: { appId: action.appId, screen: action.screen ?? 'home', ...(action.partnerId ? { partnerId: action.partnerId } : {}), guided: false } };
  }
  const closed = free.preview ? { ...free, preview: undefined } : free;
  if (action.type === 'close-preview') return closed;
  if (action.type === 'reset') return { ...closed, entries: [action.destination], position: 0 };
  if (action.type === 'go') {
    const position = Math.max(0, Math.min(closed.entries.length - 1, closed.position + action.delta));
    return position === closed.position ? closed : { ...closed, position };
  }
  return move(closed, action.destination, action.type === 'replace');
}
