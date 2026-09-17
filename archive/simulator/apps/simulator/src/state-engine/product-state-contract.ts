import type { EngineContext } from './engine-context.ts';
import type {
  SimulatorProductAgentStatus,
  SimulatorProductLedgerKind,
  SimulatorProductLedgerResult,
} from './product-flows.ts';
import { SIMULATOR_ERROR_CODES } from './errors.ts';
import { SIMULATOR_PRODUCT_FLOW_IDS } from './product-flows.ts';
import type { SimulatorSchema } from './schema.ts';

export const SIMULATOR_PRODUCT_COMMANDS = Object.freeze({
  grantToggle: 'simulator.product.grant.toggle',
  grantResolve: 'simulator.product.grant.resolve',
  consentRequest: 'simulator.product.consent.request',
  consentResolve: 'simulator.product.consent.resolve',
  flowBegin: 'simulator.product.flow.begin',
  flowBlock: 'simulator.product.flow.block',
  flowStep: 'simulator.product.flow.step',
  ledgerAppend: 'simulator.product.ledger.append',
  localAgentTransition: 'simulator.product.local-agent.transition',
  personaCommit: 'simulator.product.persona.commit',
} as const);

export const SIMULATOR_PRODUCT_EVENTS = Object.freeze({
  grantChanged: 'simulator.product.grant.changed',
  ledgerAppended: 'simulator.product.ledger.appended',
  consentChanged: 'simulator.product.consent.changed',
  flowChanged: 'simulator.product.flow.changed',
  localAgentChanged: 'simulator.product.local-agent.changed',
  personaChanged: 'simulator.product.persona.changed',
} as const);

export type SimulatorProductFlowStatus =
  | 'idle'
  | 'running'
  | 'awaiting-consent'
  | 'blocked'
  | 'denied'
  | 'completed';

export const PRODUCT_AGENT_STATUSES: readonly SimulatorProductAgentStatus[] = [
  'idle',
  'observing',
  'migrating',
  'acting',
];
export const PRODUCT_LEDGER_KINDS: readonly SimulatorProductLedgerKind[] = [
  'delegation',
  'agent-action',
  'flow',
  'system',
];
export const PRODUCT_LEDGER_RESULTS: readonly SimulatorProductLedgerResult[] = [
  'committed',
  'pending',
  'unsupported',
  'denied',
  'info',
];
export const PRODUCT_FLOW_STATUSES: readonly SimulatorProductFlowStatus[] = [
  'idle',
  'running',
  'awaiting-consent',
  'blocked',
  'denied',
  'completed',
];

const FLOW_ID_SCHEMA: SimulatorSchema = {
  kind: 'stringEnum',
  values: SIMULATOR_PRODUCT_FLOW_IDS,
};
const nullableTextSchema = (maxLength: number): SimulatorSchema => ({
  kind: 'union',
  variants: [{ kind: 'null' }, { kind: 'string', minLength: 1, maxLength }],
});

export function productLedgerEntrySchema(): SimulatorSchema {
  return {
    kind: 'object',
    properties: {
      kind: { kind: 'stringEnum', values: PRODUCT_LEDGER_KINDS },
      title: { kind: 'string', minLength: 1, maxLength: 256 },
      detail: { kind: 'string', minLength: 1, maxLength: 1024 },
      actors: { kind: 'array', items: { kind: 'string', minLength: 1, maxLength: 64 }, minItems: 1, maxItems: 8 },
      tags: { kind: 'array', items: { kind: 'string', minLength: 1, maxLength: 64 }, maxItems: 8 },
      result: { kind: 'stringEnum', values: PRODUCT_LEDGER_RESULTS },
    },
  };
}

export const PRODUCT_EVENT_SCHEMAS: Readonly<Record<string, SimulatorSchema>> = {
  [SIMULATOR_PRODUCT_EVENTS.grantChanged]: {
    kind: 'object',
    properties: {
      grantId: { kind: 'string', minLength: 1, maxLength: 64 },
      status: { kind: 'stringEnum', values: ['active', 'revoked'] },
    },
  },
  [SIMULATOR_PRODUCT_EVENTS.ledgerAppended]: {
    kind: 'object',
    properties: {
      entryId: { kind: 'string', minLength: 1, maxLength: 64 },
      kind: { kind: 'stringEnum', values: PRODUCT_LEDGER_KINDS },
      result: { kind: 'stringEnum', values: PRODUCT_LEDGER_RESULTS },
    },
  },
  [SIMULATOR_PRODUCT_EVENTS.consentChanged]: {
    kind: 'object',
    properties: {
      consent: {
        kind: 'union',
        variants: [
          { kind: 'null' },
          {
            kind: 'object',
            properties: {
              flowId: FLOW_ID_SCHEMA,
              grantId: { kind: 'string', minLength: 1, maxLength: 64 },
              origin: { kind: 'string', minLength: 1, maxLength: 64 },
            },
          },
        ],
      },
    },
  },
  [SIMULATOR_PRODUCT_EVENTS.flowChanged]: {
    kind: 'object',
    properties: {
      flowId: nullableTextSchema(64),
      stepIndex: { kind: 'integer', minimum: 0 },
      status: { kind: 'stringEnum', values: PRODUCT_FLOW_STATUSES },
      currentDirective: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'json' }] },
    },
  },
  [SIMULATOR_PRODUCT_EVENTS.localAgentChanged]: {
    kind: 'object',
    properties: {
      status: { kind: 'stringEnum', values: PRODUCT_AGENT_STATUSES },
      location: { kind: 'string', minLength: 1, maxLength: 64 },
      carry: nullableTextSchema(256),
    },
  },
  [SIMULATOR_PRODUCT_EVENTS.personaChanged]: {
    kind: 'object',
    properties: {
      persona: {
        kind: 'union',
        variants: [
          { kind: 'null' },
          {
            kind: 'object',
            properties: {
              name: { kind: 'string', minLength: 1, maxLength: 128 },
              id: { kind: 'string', minLength: 1, maxLength: 128 },
              role: { kind: 'string', minLength: 1, maxLength: 128 },
            },
          },
        ],
      },
    },
  },
};

export function registerProductCommands(context: EngineContext): void {
  const register = (type: string, payloadSchema: SimulatorSchema): void => {
    context.catalog.registerCommand({
      kind: 'command',
      type,
      owner: { kind: 'shell' },
      payloadSchema,
      writeSet: ['shell'],
      requiredCapabilities: [],
    });
  };
  register(SIMULATOR_PRODUCT_COMMANDS.grantToggle, {
    kind: 'object',
    properties: { grantId: { kind: 'string', minLength: 1, maxLength: 64 } },
  });
  register(SIMULATOR_PRODUCT_COMMANDS.grantResolve, {
    kind: 'object',
    properties: {
      grantId: { kind: 'string', minLength: 1, maxLength: 64 },
      accept: { kind: 'boolean' },
    },
  });
  register(SIMULATOR_PRODUCT_COMMANDS.consentRequest, {
    kind: 'object',
    properties: { flowId: FLOW_ID_SCHEMA },
  });
  register(SIMULATOR_PRODUCT_COMMANDS.consentResolve, {
    kind: 'object',
    properties: { accept: { kind: 'boolean' } },
  });
  register(SIMULATOR_PRODUCT_COMMANDS.flowBegin, {
    kind: 'object',
    properties: { flowId: FLOW_ID_SCHEMA },
  });
  register(SIMULATOR_PRODUCT_COMMANDS.flowBlock, {
    kind: 'object',
    properties: {
      flowId: FLOW_ID_SCHEMA,
      stepIndex: { kind: 'integer', minimum: 0 },
      errorCode: { kind: 'stringEnum', values: SIMULATOR_ERROR_CODES },
    },
  });
  register(SIMULATOR_PRODUCT_COMMANDS.flowStep, {
    kind: 'object',
    properties: {
      flowId: FLOW_ID_SCHEMA,
      stepIndex: { kind: 'integer', minimum: 0 },
    },
  });
  register(SIMULATOR_PRODUCT_COMMANDS.ledgerAppend, productLedgerEntrySchema());
  register(SIMULATOR_PRODUCT_COMMANDS.localAgentTransition, {
    kind: 'object',
    properties: {
      status: { kind: 'stringEnum', values: PRODUCT_AGENT_STATUSES },
      location: { kind: 'string', minLength: 1, maxLength: 64 },
      carry: nullableTextSchema(256),
    },
  });
  register(SIMULATOR_PRODUCT_COMMANDS.personaCommit, {
    kind: 'object',
    properties: {
      name: { kind: 'string', minLength: 1, maxLength: 128 },
      id: { kind: 'string', minLength: 1, maxLength: 128 },
      role: { kind: 'string', minLength: 1, maxLength: 128 },
    },
  });
}
