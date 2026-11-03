import type { AgentCenterSectionId } from '@nimiplatform/kit/features/agent-center';
export type ZhiyuDemoDestination = { partnerId: string | null; panel?: AgentCenterSectionId };
export type ZhiyuDemoNavigation = { entries: readonly ZhiyuDemoDestination[]; index: number };
export function reduceZhiyuDemoNavigation(
  state: ZhiyuDemoNavigation,
  action: { type: 'push'; destination: ZhiyuDemoDestination } | { type: 'go'; delta: -1 | 1 },
): ZhiyuDemoNavigation {
  if (action.type === 'go')
    return { ...state, index: Math.max(0, Math.min(state.entries.length - 1, state.index + action.delta)) };
  const current = state.entries[state.index]!;
  if (current.partnerId === action.destination.partnerId && current.panel === action.destination.panel)
    return state;
  return {
    entries: [...state.entries.slice(0, state.index + 1), action.destination],
    index: state.index + 1,
  };
}
