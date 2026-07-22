import type { JsonValue } from '../state-engine/json-value.ts';
import type { SimulatorInteractionDeclaration } from '../state-engine/interactions.ts';

const REFERENCE_TYPE = 'ecosystem.reference.checkpoint' as const;

function record(value: JsonValue): Readonly<Record<string, JsonValue>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, JsonValue>>
    : {};
}

const referenceInteraction: SimulatorInteractionDeclaration = {
  type: REFERENCE_TYPE,
  sourceModuleId: 'desktop',
  targets: Object.freeze([
    Object.freeze({ moduleId: 'zhiyu', commandType: 'zhiyu.ecosystem.project' }),
    Object.freeze({
      moduleId: 'tester',
      commandType: 'tester.ecosystem.observe',
      afterEventType: 'zhiyu.ecosystem.projected',
    }),
  ]),
  payloadSchema: {
    kind: 'object',
    properties: {
      checkpointId: { kind: 'string', minLength: 1, maxLength: 128 },
      label: { kind: 'string', minLength: 1, maxLength: 256 },
    },
  },
  reduce(input) {
    const payload = record(input.payload);
    const reference = Object.freeze({
      protocolRevision: 1,
      ecosystemRevision: input.ecosystemRevision,
      interactionId: input.interactionId,
      checkpointId: payload.checkpointId as string,
      label: payload.label as string,
      committedAt: input.logicalTime,
    });
    return Object.freeze({
      ecosystem: Object.freeze({ ...record(input.ecosystem), reference }),
      targetPayload: reference,
    });
  },
};

export const simulatorReferenceInteraction = Object.freeze(referenceInteraction);

export const simulatorReferenceInteractionCatalog = Object.freeze([
  simulatorReferenceInteraction,
]);
