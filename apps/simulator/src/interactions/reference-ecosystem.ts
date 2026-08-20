import type { SimulatorInteractionDeclaration } from '../state-engine/interactions.ts';
import { simulatorProductInteractionCatalog } from './product-interactions.ts';

const REFERENCE_TYPE = 'ecosystem.reference.publish' as const;

const referenceInteraction: SimulatorInteractionDeclaration = {
  type: REFERENCE_TYPE,
  sourceModuleId: 'desktop',
  targets: Object.freeze([
    Object.freeze({ moduleId: 'zhiyu', commandType: 'zhiyu.ecosystem.project' }),
    Object.freeze({
      moduleId: 'lab',
      commandType: 'lab.ecosystem.observe',
      afterEventType: 'zhiyu.ecosystem.projected',
    }),
  ]),
  payloadSchema: {
    kind: 'object',
    properties: {},
  },
  reduce(input) {
    const ecosystem = input.ecosystem && typeof input.ecosystem === 'object' && !Array.isArray(input.ecosystem)
      ? input.ecosystem
      : {};
    const reference = Object.freeze({
      protocolRevision: 1,
      ecosystemRevision: input.ecosystemRevision,
      interactionId: input.interactionId,
      committedAt: input.logicalTime,
    });
    return Object.freeze({
      ecosystem: Object.freeze({ ...ecosystem, reference }),
      targetPayload: reference,
    });
  },
};

export const simulatorReferenceInteraction = Object.freeze(referenceInteraction);

export const simulatorReferenceInteractionCatalog = Object.freeze([
  simulatorReferenceInteraction,
  ...simulatorProductInteractionCatalog,
]);
