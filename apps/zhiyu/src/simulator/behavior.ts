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
  readonly ecosystemReference: JsonRecord | null;
  readonly personaReference: JsonRecord | null;
  readonly handoff: JsonRecord | null;
  readonly carry: JsonRecord | null;
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

function interactionEnvelope(payload: JsonRecord, label: string): {
  readonly ecosystemRevision: number;
  readonly interactionId: string;
  readonly committedAt: number;
} {
  if (payload.protocolRevision !== 1
    || !Number.isSafeInteger(payload.ecosystemRevision)
    || typeof payload.interactionId !== 'string'
    || !Number.isSafeInteger(payload.committedAt)) {
    throw new Error(`ZHIYU_SIMULATOR_${label}_INVALID`);
  }
  return {
    ecosystemRevision: payload.ecosystemRevision as number,
    interactionId: payload.interactionId,
    committedAt: payload.committedAt as number,
  };
}

function personaPayload(payload: JsonRecord): JsonRecord {
  const persona = record(payload.persona, 'PERSONA_REFERENCE');
  return {
    accountId: text(persona.accountId, 'PERSONA_ACCOUNT'),
    userId: text(persona.userId, 'PERSONA_USER'),
    displayName: text(persona.displayName, 'PERSONA_DISPLAY_NAME'),
    role: text(persona.role, 'PERSONA_ROLE'),
    realmEnvironmentId: text(persona.realmEnvironmentId, 'PERSONA_REALM_ENV'),
  };
}

function personaReference(value: ZhiyuSimulatorJsonValue): JsonRecord {
  const payload = record(value, 'PERSONA_REFERENCE');
  const meta = interactionEnvelope(payload, 'PERSONA_REFERENCE');
  return {
    protocolRevision: 1,
    ecosystemRevision: meta.ecosystemRevision,
    interactionId: meta.interactionId,
    persona: personaPayload(payload),
    committedAt: meta.committedAt,
  };
}

function cardPayload(payload: JsonRecord): JsonRecord {
  const card = record(payload.card, 'REQUEST_CARD');
  return {
    title: text(card.title, 'REQUEST_CARD_TITLE'),
    detail: text(card.detail, 'REQUEST_CARD_DETAIL'),
  };
}

export const zhiyuSimulatorBehavior = Object.freeze({
  initialState(input: ZhiyuSimulatorInitialInput): ZhiyuSimulatorJsonValue {
    const shared = record(input.sharedProjection, 'SHARED_PROJECTION');
    return {
      protocolRevision: 1,
      scenario: scenarioData(input.moduleData),
      turnSequence: 0,
      turns: [],
      ecosystemReference: null,
      personaReference: shared.persona === undefined || shared.persona === null
        ? null
        : personaReference(shared.persona),
      handoff: null,
      carry: null,
    };
  },
  reduce(
    currentValue: ZhiyuSimulatorJsonValue,
    envelope: ZhiyuSimulatorCommandEnvelope,
    context: ZhiyuSimulatorBehaviorContext,
  ) {
    const current = state(currentValue);
    const payload = record(envelope.payload, 'COMMAND_PAYLOAD');
    if (envelope.type === 'zhiyu.ecosystem.project') {
      if (payload.protocolRevision !== 1
        || !Number.isSafeInteger(payload.ecosystemRevision)
        || typeof payload.interactionId !== 'string'
        || !Number.isSafeInteger(payload.committedAt)) {
        throw new Error('ZHIYU_SIMULATOR_ECOSYSTEM_REFERENCE_INVALID');
      }
      const reference = {
        protocolRevision: 1,
        ecosystemRevision: payload.ecosystemRevision,
        interactionId: payload.interactionId,
        committedAt: payload.committedAt,
      };
      return {
        state: { ...current, ecosystemReference: reference },
        events: [{ type: 'zhiyu.ecosystem.projected', payload: reference }],
      };
    }
    if (envelope.type === 'zhiyu.persona.project') {
      const reference = personaReference(payload);
      return {
        state: { ...current, personaReference: reference },
        events: [{ type: 'zhiyu.persona.projected', payload: reference }],
      };
    }
    if (envelope.type === 'zhiyu.handoff.accept') {
      const meta = interactionEnvelope(payload, 'HANDOFF');
      const route = record(payload.route, 'HANDOFF_ROUTE');
      if (typeof route.pathname !== 'string' || !Array.isArray(route.search)) {
        throw new Error('ZHIYU_SIMULATOR_HANDOFF_INVALID');
      }
      return {
        state: {
          ...current,
          handoff: {
            targetSurfaceId: text(payload.targetSurfaceId, 'HANDOFF_SURFACE'),
            route: {
              pathname: route.pathname,
              search: route.search,
              fragment: route.fragment === null || typeof route.fragment === 'string' ? route.fragment : null,
            },
            card: cardPayload(payload),
            committedAt: meta.committedAt,
          },
        },
        events: [],
      };
    }
    if (envelope.type === 'zhiyu.carry.accept') {
      const meta = interactionEnvelope(payload, 'CARRY');
      return {
        state: {
          ...current,
          carry: {
            carry: text(payload.carry, 'CARRY_SUMMARY'),
            card: cardPayload(payload),
            committedAt: meta.committedAt,
          },
        },
        events: [],
      };
    }
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
