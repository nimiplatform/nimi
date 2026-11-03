import type { HeroDemoSurface } from './landing-content.js';

export type DemoDestination = { surface: HeroDemoSurface; target?: string };
export type DemoNavigation = { entries: readonly DemoDestination[]; position: number; section?: number };
export type DemoNavigationAction =
  | { type: 'push' | 'replace' | 'reset'; destination: DemoDestination }
  | { type: 'go'; delta: -1 | 1 }
  | { type: 'enter-section'; index: number };

export function initialDemoSurface(hash: string): HeroDemoSurface {
  return hash === '#apps' ? 'chat' : 'home';
}

/** One atomic history for both presentations of the same demo session. */
export function reduceDemoNavigation(state: DemoNavigation, action: DemoNavigationAction): DemoNavigation {
  if (action.type === 'reset') {
    return { ...state, entries: [action.destination], position: 0 };
  }
  if (action.type === 'enter-section') {
    // Entry defaults are applied once per actual landing-page transition.
    // Remaining in a section must not undo navigation inside its demo.
    if (state.section === action.index) return state;
    const next = { ...state, section: action.index };
    if (action.index !== 0 && action.index !== 1) return next;
    return reduceDemoNavigation(next, {
      type: 'replace',
      destination: { surface: action.index === 0 ? 'home' : 'chat' },
    });
  }
  if (action.type === 'go') {
    const position = Math.max(0, Math.min(state.entries.length - 1, state.position + action.delta));
    return position === state.position ? state : { ...state, position };
  }
  const current = state.entries[state.position]!;
  if (current.surface === action.destination.surface && current.target === action.destination.target)
    return state;
  if (action.type === 'replace')
    return {
      ...state,
      entries: state.entries.map((entry, index) => (index === state.position ? action.destination : entry)),
    };
  return {
    ...state,
    entries: [...state.entries.slice(0, state.position + 1), action.destination],
    position: state.position + 1,
  };
}
