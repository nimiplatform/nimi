import type {
  ZhiyuSimulatorBehaviorContext,
  ZhiyuSimulatorCommandEnvelope,
  ZhiyuSimulatorInitialInput,
  ZhiyuSimulatorJsonValue,
  ZhiyuSimulatorProjectionInput,
} from './protocol.js';

type JsonRecord = { readonly [key: string]: ZhiyuSimulatorJsonValue };

interface ZhiyuScenarioData extends JsonRecord {
  readonly ownerUserId: string;
  readonly agents: readonly {
    readonly localAgentRef: string;
    readonly runtimeSourceRef: string;
    readonly displayName: string;
  }[];
  readonly responseText: string;
}

interface ZhiyuSimulatorState extends JsonRecord {
  readonly protocolRevision: 1;
  readonly scenario: ZhiyuScenarioData;
  readonly turnSequence: number;
  readonly turns: readonly JsonRecord[];
}

function record(value: ZhiyuSimulatorJsonValue, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`ZHIYU_SIMULATOR_${label}_INVALID`);
  }
  return value as JsonRecord;
}

function text(value: ZhiyuSimulatorJsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`ZHIYU_SIMULATOR_${label}_INVALID`);
  return value;
}

function scenarioData(value: ZhiyuSimulatorJsonValue): ZhiyuScenarioData {
  const input = record(value, 'SCENARIO_DATA');
  if (!Array.isArray(input.agents) || input.agents.length < 1 || input.agents.length > 8) {
    throw new Error('ZHIYU_SIMULATOR_AGENTS_INVALID');
  }
  const agents = input.agents.map((entry, index) => {
    const agent = record(entry, `AGENT_${index}`);
    return {
      localAgentRef: text(agent.localAgentRef, 'LOCAL_AGENT_REF'),
      runtimeSourceRef: text(agent.runtimeSourceRef, 'RUNTIME_SOURCE_REF'),
      displayName: text(agent.displayName, 'DISPLAY_NAME'),
    };
  });
  return {
    ownerUserId: text(input.ownerUserId, 'OWNER_USER_ID'),
    agents,
    responseText: text(input.responseText, 'RESPONSE_TEXT'),
  };
}

function state(value: ZhiyuSimulatorJsonValue): ZhiyuSimulatorState {
  const candidate = record(value, 'STATE');
  if (candidate.protocolRevision !== 1 || !Array.isArray(candidate.turns)) {
    throw new Error('ZHIYU_SIMULATOR_STATE_INVALID');
  }
  return candidate as unknown as ZhiyuSimulatorState;
}

export const zhiyuSimulatorBehavior = Object.freeze({
  initialState(input: ZhiyuSimulatorInitialInput): ZhiyuSimulatorJsonValue {
    return {
      protocolRevision: 1,
      scenario: scenarioData(input.moduleData),
      turnSequence: 0,
      turns: [],
    };
  },
  reduce(
    currentValue: ZhiyuSimulatorJsonValue,
    envelope: ZhiyuSimulatorCommandEnvelope,
    context: ZhiyuSimulatorBehaviorContext,
  ) {
    const current = state(currentValue);
    const payload = record(envelope.payload, 'COMMAND_PAYLOAD');
    if (envelope.type === 'zhiyu.turn.allocate') {
      return { state: { ...current, turnSequence: current.turnSequence + 1 }, events: [] };
    }
    if (envelope.type === 'zhiyu.turn.submit') {
      const turn = {
        requestId: text(payload.requestId, 'REQUEST_ID'),
        text: text(payload.text, 'TURN_TEXT'),
        responseText: current.scenario.responseText,
        committedAt: context.now,
      };
      return {
        state: { ...current, turns: [...current.turns, turn].slice(-64) },
        events: [{
          type: 'zhiyu.conversation.updated',
          payload: { requestId: turn.requestId, responseText: turn.responseText },
        }],
      };
    }
    throw new Error(`ZHIYU_SIMULATOR_COMMAND_UNDECLARED:${envelope.type}`);
  },
  project(
    currentValue: ZhiyuSimulatorJsonValue,
    instance: ZhiyuSimulatorProjectionInput,
  ): ZhiyuSimulatorJsonValue {
    return {
      ...state(currentValue),
      surfaceId: instance.surfaceId,
      route: {
        pathname: instance.route.pathname,
        search: instance.route.search.map(({ key, value }) => ({ key, value })),
        fragment: instance.route.fragment,
      },
    };
  },
});
