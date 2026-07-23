/**
 * Declared cross-App product interactions (nimi.simulator.interaction/v1):
 * persona share, surface handoff, and agent-mediated context carry. Each
 * reduce commits an ecosystem record, a typed target payload, and — through
 * the declared `product` effects — atomic Shell-partition truth (persona,
 * ledger, target-surface routes). All copy carries 模拟 honesty labeling.
 *
 * Authority: P-SIM-001, P-SIM-010, P-SIM-015.
 */

import type { JsonValue } from '../state-engine/json-value.ts';
import type { SimulatorInteractionDeclaration } from '../state-engine/interactions.ts';
import { SIMULATOR_PRODUCT_CARRY_ROUTE } from '../state-engine/product-flows.ts';

function record(value: JsonValue): Readonly<Record<string, JsonValue>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, JsonValue>>
    : {};
}

function text(value: JsonValue, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`SIMULATOR_INTERACTION_${label}_INVALID`);
  }
  return value;
}

const ROUTE_SCHEMA = {
  kind: 'object',
  properties: {
    pathname: { kind: 'string', minLength: 1, maxLength: 512 },
    search: {
      kind: 'array',
      items: {
        kind: 'object',
        properties: {
          key: { kind: 'string', minLength: 1, maxLength: 128 },
          value: { kind: 'string', minLength: 1, maxLength: 256 },
        },
      },
      maxItems: 8,
    },
    fragment: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'string', maxLength: 256 }] },
  },
} as const;

const CARD_SCHEMA = {
  kind: 'object',
  properties: {
    title: { kind: 'string', minLength: 1, maxLength: 256 },
    detail: { kind: 'string', minLength: 1, maxLength: 1024 },
  },
} as const;

const PERSONA_SCHEMA = {
  kind: 'object',
  properties: {
    accountId: { kind: 'string', minLength: 1, maxLength: 128 },
    userId: { kind: 'string', minLength: 1, maxLength: 128 },
    displayName: { kind: 'string', minLength: 1, maxLength: 128 },
    role: { kind: 'string', minLength: 1, maxLength: 128 },
    realmEnvironmentId: { kind: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

const personaShareInteraction: SimulatorInteractionDeclaration = {
  type: 'session.persona.share',
  sourceModuleId: 'desktop',
  targets: Object.freeze([
    Object.freeze({ moduleId: 'zhiyu', commandType: 'zhiyu.persona.project' }),
    Object.freeze({
      moduleId: 'tester',
      commandType: 'tester.persona.observe',
      afterEventType: 'zhiyu.persona.projected',
    }),
  ]),
  payloadSchema: PERSONA_SCHEMA,
  reduce(input) {
    const payload = record(input.payload);
    const persona = Object.freeze({
      accountId: text(payload.accountId, 'PERSONA_ACCOUNT'),
      userId: text(payload.userId, 'PERSONA_USER'),
      displayName: text(payload.displayName, 'PERSONA_DISPLAY_NAME'),
      role: text(payload.role, 'PERSONA_ROLE'),
      realmEnvironmentId: text(payload.realmEnvironmentId, 'PERSONA_REALM_ENV'),
    });
    const currentEcosystem = record(input.ecosystem);
    const existingReference = record(currentEcosystem.persona);
    const existingPersona = record(existingReference.persona);
    if (existingPersona.accountId === persona.accountId
      && existingPersona.userId === persona.userId
      && existingPersona.displayName === persona.displayName
      && existingPersona.role === persona.role
      && existingPersona.realmEnvironmentId === persona.realmEnvironmentId) {
      return Object.freeze({
        ecosystem: input.ecosystem,
        targetPayload: existingReference,
        idempotent: true,
      });
    }
    const reference = Object.freeze({
      protocolRevision: 1,
      ecosystemRevision: input.ecosystemRevision,
      interactionId: input.interactionId,
      persona,
      committedAt: input.logicalTime,
    });
    return Object.freeze({
      ecosystem: Object.freeze({ ...record(input.ecosystem), persona: reference }),
      targetPayload: reference,
      product: Object.freeze({
        persona: Object.freeze({
          name: persona.displayName,
          id: persona.userId,
          role: persona.role,
        }),
        ledger: Object.freeze([Object.freeze({
          kind: 'delegation' as const,
          title: `身份共享 · ${persona.displayName}`,
          detail: '模拟生态：Desktop 完成模拟登录，居民身份以只读投影共享给 Zhiyu 与 Tester。',
          actors: Object.freeze([persona.displayName, 'Desktop', '生态共享']),
          result: 'committed' as const,
        })]),
      }),
    });
  },
};

const handoffInteraction: SimulatorInteractionDeclaration = {
  type: 'handoff.surface.commit',
  sourceModuleId: 'desktop',
  targets: Object.freeze([
    Object.freeze({ moduleId: 'zhiyu', commandType: 'zhiyu.handoff.accept' }),
  ]),
  payloadSchema: {
    kind: 'object',
    properties: {
      targetSurfaceId: { kind: 'string', minLength: 1, maxLength: 64 },
      route: ROUTE_SCHEMA,
      card: CARD_SCHEMA,
    },
  },
  reduce(input) {
    const payload = record(input.payload);
    const card = record(payload.card as JsonValue);
    const reference = Object.freeze({
      protocolRevision: 1,
      ecosystemRevision: input.ecosystemRevision,
      interactionId: input.interactionId,
      targetSurfaceId: text(payload.targetSurfaceId, 'HANDOFF_SURFACE'),
      route: payload.route as JsonValue,
      card: Object.freeze({
        title: text(card.title, 'HANDOFF_CARD_TITLE'),
        detail: text(card.detail, 'HANDOFF_CARD_DETAIL'),
      }),
      committedAt: input.logicalTime,
    });
    const target = handoffInteraction.targets[0] as { readonly moduleId: string };
    return Object.freeze({
      ecosystem: Object.freeze({ ...record(input.ecosystem), handoff: reference }),
      targetPayload: reference,
      product: Object.freeze({
        routes: Object.freeze([Object.freeze({
          moduleId: target.moduleId,
          route: payload.route as JsonValue,
        })]),
        ledger: Object.freeze([Object.freeze({
          kind: 'flow' as const,
          title: '意图交接 · Desktop → Zhiyu',
          detail: '模拟交接：「在织语中继续」被翻译为 Zhiyu 的实例路由状态；未发生应用间私有调用。',
          actors: Object.freeze(['Desktop', 'Zhiyu']),
          result: 'committed' as const,
        })]),
      }),
    });
  },
};

const carryInteraction: SimulatorInteractionDeclaration = {
  type: 'agent.context.carry',
  sourceModuleId: 'desktop',
  targets: Object.freeze([
    Object.freeze({ moduleId: 'zhiyu', commandType: 'zhiyu.carry.accept' }),
  ]),
  payloadSchema: {
    kind: 'object',
    properties: {
      carry: { kind: 'string', minLength: 1, maxLength: 512 },
      card: CARD_SCHEMA,
    },
  },
  reduce(input) {
    const payload = record(input.payload);
    const card = record(payload.card as JsonValue);
    const reference = Object.freeze({
      protocolRevision: 1,
      ecosystemRevision: input.ecosystemRevision,
      interactionId: input.interactionId,
      carry: text(payload.carry, 'CARRY_SUMMARY'),
      card: Object.freeze({
        title: text(card.title, 'CARRY_CARD_TITLE'),
        detail: text(card.detail, 'CARRY_CARD_DETAIL'),
      }),
      committedAt: input.logicalTime,
    });
    const target = carryInteraction.targets[0] as { readonly moduleId: string };
    return Object.freeze({
      ecosystem: Object.freeze({ ...record(input.ecosystem), carry: reference }),
      targetPayload: reference,
      product: Object.freeze({
        routes: Object.freeze([Object.freeze({
          moduleId: target.moduleId,
          route: SIMULATOR_PRODUCT_CARRY_ROUTE as unknown as JsonValue,
        })]),
        ledger: Object.freeze([
          Object.freeze({
            kind: 'delegation' as const,
            title: '委托 · 携带会话摘要',
            detail: '模拟委托：你委托基座 agent Nimi 将本次 Desktop 会话摘要带往 Zhiyu。',
            actors: Object.freeze(['模拟居民', 'Nimi']),
            result: 'committed' as const,
          }),
          Object.freeze({
            kind: 'agent-action' as const,
            title: 'agent 行动 · 摘要投递',
            detail: '模拟投递：Nimi 将只读摘要投影投递到 Zhiyu 实例。投递内容不含任何写权限。',
            actors: Object.freeze(['Nimi', 'Zhiyu']),
            result: 'committed' as const,
          }),
        ]),
      }),
    });
  },
};

export const simulatorProductInteractionCatalog = Object.freeze([
  personaShareInteraction,
  handoffInteraction,
  carryInteraction,
]);
