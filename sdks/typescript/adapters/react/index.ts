import type { NimiCapabilityManifest } from '../../core/contracts';
import type { NimiConversationFeatureEvent } from '../../features/conversation';

export const NIMI_REACT_ADAPTER_ID = 'react' as const;
export const NIMI_REACT_UNSUPPORTED_FEATURE_CODE = 'SDK_ADAPTER_FEATURE_UNSUPPORTED' as const;

export const NIMI_REACT_ADAPTER_MANIFEST = {
  adapterId: NIMI_REACT_ADAPTER_ID,
  targetLibrary: 'React',
  targetVersionRange: 'headless-state-v1',
  capabilityLevel: 'L1',
  capabilities: {
    'conversation.state': { support: 'supported', mode: 'adapter-mapped' },
    'conversation.events': { support: 'supported', mode: 'adapter-mapped' },
    hooks: { support: 'unsupported', mode: 'adapter-mapped' },
    renderer: { support: 'unsupported', mode: 'adapter-mapped' },
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;

export interface NimiReactConversationState {
  readonly status: 'idle' | 'running' | 'completed' | 'failed';
  readonly text: string;
  readonly toolCalls: readonly { readonly id: string; readonly name: string }[];
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
}

export class NimiReactUnsupportedFeatureError extends Error {
  readonly code = NIMI_REACT_UNSUPPORTED_FEATURE_CODE;
  readonly feature: string;

  constructor(feature: string, detail?: string) {
    super(detail ? `${feature}: ${detail}` : feature);
    this.name = 'NimiReactUnsupportedFeatureError';
    this.feature = feature;
  }
}

export function throwUnsupportedReactFeature(feature: string, detail?: string): never {
  throw new NimiReactUnsupportedFeatureError(feature, detail);
}

export const NIMI_REACT_INITIAL_CONVERSATION_STATE: NimiReactConversationState = {
  status: 'idle',
  text: '',
  toolCalls: [],
  warnings: [],
};

export function reduceNimiReactConversationEvent(
  state: NimiReactConversationState,
  event: NimiConversationFeatureEvent,
): NimiReactConversationState {
  if (event.type === 'conversation.started') {
    return { ...state, status: 'running' };
  }
  if (event.type === 'conversation.text_delta') {
    return { ...state, text: `${state.text}${event.text}` };
  }
  if (event.type === 'conversation.tool_call') {
    return { ...state, toolCalls: [...state.toolCalls, { id: event.id, name: event.name }] };
  }
  if (event.type === 'conversation.warning') {
    return { ...state, warnings: [...state.warnings, { code: event.code, message: event.message }] };
  }
  if (event.type === 'conversation.completed') {
    return { ...state, status: 'completed' };
  }
  return state;
}

export function createNimiReactConversationStore(
  events: readonly NimiConversationFeatureEvent[] = [],
): NimiReactConversationState {
  return events.reduce(reduceNimiReactConversationEvent, NIMI_REACT_INITIAL_CONVERSATION_STATE);
}

export function useNimiReactConversation(): never {
  throwUnsupportedReactFeature('hooks', 'React runtime hooks are adapter-package work and are not included in the base source root');
}
