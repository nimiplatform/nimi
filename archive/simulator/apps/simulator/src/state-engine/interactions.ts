/**
 * Simulator-owned cross-App interaction catalog and deterministic ecosystem
 * transaction. Continuations are transient and keyed by the actual derived
 * operation identity; an event name alone can never advance an interaction.
 *
 * Authority: P-SIM-010, P-SIM-011, P-SIM-015, P-SIM-019.
 */

import { assertJsonValue, freezeJsonValue, type JsonValue } from './json-value.ts';
import {
  simulatorError,
  simulatorFail,
  simulatorOk,
  type SimulatorError,
} from './errors.ts';
import { formatCanonicalId } from './ids.ts';
import { validateSchema, type SimulatorSchema } from './schema.ts';
import type { EngineContext } from './engine-context.ts';
import { freezeCommittedState, recordSettlement } from './engine-context.ts';
import { notifyStateSubscribers } from './module-commands.ts';
import { SimulatorIntegrityAbort, type QueuedOperation } from './engine-types.ts';
import type { SimulatorEventRecord, SimulatorIssuer } from './types.ts';

import {
  applyInteractionProductEffects,
  type SimulatorInteractionProductEffects,
} from './product-state.ts';

export const SIMULATOR_INTERACTION_EMIT = 'simulator.interaction.emit' as const;

export interface SimulatorInteractionTargetDeclaration {
  readonly moduleId: string;
  readonly commandType: string;
  /** Every stage after the first follows this event from the preceding stage. */
  readonly afterEventType?: string;
}

export interface SimulatorInteractionDeclaration {
  readonly type: string;
  readonly sourceModuleId: string;
  readonly targets: readonly SimulatorInteractionTargetDeclaration[];
  readonly payloadSchema: SimulatorSchema;
  reduce(input: {
    readonly ecosystem: JsonValue;
    readonly payload: JsonValue;
    readonly source: { readonly moduleId: string; readonly instanceId: string };
    readonly interactionId: string;
    readonly logicalTime: number;
    readonly ecosystemRevision: number;
  }): {
    readonly ecosystem: JsonValue;
    readonly targetPayload: JsonValue;
    /** Optional declared Shell-partition product effects, committed atomically. */
    readonly product?: SimulatorInteractionProductEffects;
    /** A duplicate against committed State Engine truth settles without a commit or target dispatch. */
    readonly idempotent?: boolean;
  };
}

const INTERACTION_ID = { kind: 'string', minLength: 1, maxLength: 256 } as const;
const MODULE_ID = { kind: 'string', pattern: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u } as const;

export const SIMULATOR_INTERACTION_ENVELOPE_SCHEMA: SimulatorSchema = {
  kind: 'object',
  properties: {
    protocol: { kind: 'stringEnum', values: ['nimi.simulator.interaction/v1'] },
    interactionId: INTERACTION_ID,
    source: {
      kind: 'object',
      properties: {
        moduleId: MODULE_ID,
        instanceId: { kind: 'string', pattern: /^[0-9]+:instance:[0-9]+$/u },
      },
    },
    targets: { kind: 'array', items: MODULE_ID, minItems: 1, maxItems: 64 },
    type: { kind: 'string', pattern: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9-]*){2,}$/u },
    payload: { kind: 'json' },
  },
};

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function liveInstance(context: EngineContext, moduleId: string, instanceId?: string): boolean {
  return Object.entries(context.committed.snapshot.instances).some(([candidateId, instance]) => (
    (instanceId === undefined || candidateId === instanceId)
    && instance.moduleId === moduleId
    && (instance.status === 'inactive' || instance.status === 'active')
  ));
}

type EnqueueDerivedInteraction = (
  type: string,
  payload: JsonValue,
  issuer: SimulatorIssuer,
  causationId: string,
) => string | null;

interface PendingStage {
  readonly epoch: number;
  readonly declaration: SimulatorInteractionDeclaration;
  readonly targetIndex: number;
  readonly payload: JsonValue;
}

function errorFor(
  code: SimulatorError['code'],
  issuer: SimulatorIssuer,
  operationId: string | null = null,
): SimulatorError {
  return simulatorError(code, {
    moduleId: issuer.moduleId,
    instanceId: issuer.instanceId,
    operationId,
  });
}

function interactionAdmissionError(input: {
  readonly context: EngineContext;
  readonly envelope: Readonly<Record<string, JsonValue>>;
  readonly issuer: SimulatorIssuer;
  readonly declarations: ReadonlyMap<string, SimulatorInteractionDeclaration>;
}): SimulatorError | null {
  const { context, envelope, issuer } = input;
  const declaration = input.declarations.get(envelope.type as string);
  if (!declaration) return errorFor('SIMULATOR_UNSUPPORTED', issuer);
  const source = envelope.source as Readonly<Record<string, JsonValue>>;
  if (
    issuer.kind !== 'instance'
    || issuer.moduleId !== declaration.sourceModuleId
    || source.moduleId !== issuer.moduleId
    || source.instanceId !== issuer.instanceId
  ) return errorFor('SIMULATOR_CAPABILITY_DENIED', issuer);
  if (!liveInstance(context, declaration.sourceModuleId, issuer.instanceId as string)) {
    return errorFor('SIMULATOR_INSTANCE_DISPOSED', issuer);
  }
  const targets = envelope.targets as readonly string[];
  if (!sameOrderedStrings(targets, declaration.targets.map((target) => target.moduleId))) {
    return errorFor('SIMULATOR_INVALID_PAYLOAD', issuer);
  }
  if (!validateSchema(declaration.payloadSchema, envelope.payload as JsonValue).ok) {
    return errorFor('SIMULATOR_INVALID_PAYLOAD', issuer);
  }
  for (let index = 0; index < declaration.targets.length; index += 1) {
    const target = declaration.targets[index];
    const registration = context.catalog.command(target.commandType);
    if (
      !registration
      || registration.owner.kind !== 'module'
      || registration.owner.moduleId !== target.moduleId
      || !context.moduleCatalogs.has(target.moduleId)
      || !context.moduleBehaviors.has(target.moduleId)
      || context.committed.snapshot.modules[target.moduleId] === undefined
    ) return errorFor('SIMULATOR_UNSUPPORTED', issuer);
    if (!liveInstance(context, target.moduleId)) {
      return simulatorError('SIMULATOR_INSTANCE_DISPOSED', { moduleId: target.moduleId });
    }
    if (registration.requiredCapabilities.some((capability) => !context.capabilities.has(capability))) {
      return simulatorError('SIMULATOR_CAPABILITY_DENIED', { moduleId: target.moduleId });
    }
    if (index > 0) {
      const producer = declaration.targets[index - 1];
      if (!target.afterEventType
        || !Object.hasOwn(context.moduleCatalogs.get(producer.moduleId)?.eventSchemas ?? {}, target.afterEventType)) {
        return errorFor('SIMULATOR_UNSUPPORTED', issuer);
      }
    }
  }
  return null;
}

export function registerInteractionCommand(context: EngineContext): void {
  context.catalog.registerCommand({
    kind: 'command',
    type: SIMULATOR_INTERACTION_EMIT,
    owner: { kind: 'shell' },
    payloadSchema: SIMULATOR_INTERACTION_ENVELOPE_SCHEMA,
    writeSet: ['ecosystem', 'shell', 'instances'],
    requiredCapabilities: [],
  });
}

// @nimi-authority: definition.nimi.platform.simulator.interaction-protocol
// @nimi-authority: rule.nimi.platform.simulator.p-sim-012
export function createInteractionRuntime(
  declared: readonly SimulatorInteractionDeclaration[] | undefined,
  enqueueDerived: EnqueueDerivedInteraction,
) {
  const declarations = new Map<string, SimulatorInteractionDeclaration>();
  const pending = new Map<string, PendingStage>();
  for (const declaration of declared ?? []) {
    const invalidTopology = declaration.targets.length === 0
      || declaration.targets[0]?.afterEventType !== undefined
      || declaration.targets.slice(1).some((target) => !target.afterEventType)
      || new Set(declaration.targets.map((target) => target.moduleId)).size !== declaration.targets.length;
    if (declarations.has(declaration.type) || invalidTopology) {
      throw new Error('SIMULATOR_INTERACTION_CATALOG_INVALID');
    }
    declarations.set(declaration.type, declaration);
  }

  function abortIntegrity(operation: QueuedOperation, moduleId: string | null): never {
    throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
      moduleId,
      instanceId: operation.issuer.instanceId,
      operationId: operation.operationId,
    }));
  }

  function enqueueStage(stage: PendingStage, causationId: string): void {
    const target = stage.declaration.targets[stage.targetIndex];
    const operationId = enqueueDerived(
      target.commandType,
      stage.payload,
      { kind: 'shell', moduleId: null, instanceId: null },
      causationId,
    );
    if (!operationId || pending.has(operationId)) {
      throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
        moduleId: target.moduleId,
      }));
    }
    pending.set(operationId, stage);
  }

  return Object.freeze({
    admitBeforeQueue(
      context: EngineContext,
      type: string,
      payload: JsonValue,
      issuer: SimulatorIssuer,
    ): SimulatorError | null {
      if (type !== SIMULATOR_INTERACTION_EMIT) return null;
      return interactionAdmissionError({
        context,
        envelope: payload as Readonly<Record<string, JsonValue>>,
        issuer,
        declarations,
      });
    },
    assertExpectedDerived(context: EngineContext, operation: QueuedOperation): void {
      const stage = pending.get(operation.operationId);
      if (!stage) return;
      const target = stage.declaration.targets[stage.targetIndex];
      const registration = context.catalog.command(operation.type);
      if (
        stage.epoch !== context.epoch
        || !operation.derived
        || operation.issuer.kind !== 'shell'
        || operation.issuer.moduleId !== null
        || operation.issuer.instanceId !== null
        || operation.type !== target.commandType
        || registration?.owner.kind !== 'module'
        || registration.owner.moduleId !== target.moduleId
        || !context.moduleBehaviors.has(target.moduleId)
        || context.committed.snapshot.modules[target.moduleId] === undefined
        || !liveInstance(context, target.moduleId)
        || registration.requiredCapabilities.some((capability) => !context.capabilities.has(capability))
      ) abortIntegrity(operation, target.moduleId);
    },
    onModuleCommandCommitted(
      context: EngineContext,
      operation: QueuedOperation,
      moduleId: string,
      events: readonly SimulatorEventRecord[],
    ): void {
      const stage = pending.get(operation.operationId);
      if (!stage) return;
      const current = stage.declaration.targets[stage.targetIndex];
      if (stage.epoch !== context.epoch || current.moduleId !== moduleId || current.commandType !== operation.type) {
        abortIntegrity(operation, moduleId);
      }
      pending.delete(operation.operationId);
      const nextIndex = stage.targetIndex + 1;
      if (nextIndex >= stage.declaration.targets.length) return;
      const expectedEventType = stage.declaration.targets[nextIndex].afterEventType as string;
      const matches = events.filter((event) => (
        event.ownerModuleId === moduleId
        && event.causationOperationId === operation.operationId
        && event.fullType === expectedEventType
      ));
      if (matches.length !== 1) abortIntegrity(operation, moduleId);
      enqueueStage({ ...stage, targetIndex: nextIndex, payload: matches[0].payload }, matches[0].eventId);
    },
    process(context: EngineContext, operation: QueuedOperation): boolean {
      if (operation.type !== SIMULATOR_INTERACTION_EMIT) return false;
      const envelope = operation.payload as Readonly<Record<string, JsonValue>>;
      const admissionError = interactionAdmissionError({
        context,
        envelope,
        issuer: operation.issuer,
        declarations,
      });
      if (admissionError) {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError(admissionError.code, {
          moduleId: admissionError.moduleId,
          instanceId: admissionError.instanceId,
          operationId: operation.operationId,
        })));
        return true;
      }
      const declaration = declarations.get(envelope.type as string) as SimulatorInteractionDeclaration;
      const payload = validateSchema(declaration.payloadSchema, envelope.payload as JsonValue);
      if (!payload.ok) abortIntegrity(operation, operation.issuer.moduleId);
      const ecosystemRevision = context.committed.revision + 1;
      let reduction: ReturnType<SimulatorInteractionDeclaration['reduce']>;
      try {
        reduction = declaration.reduce({
          ecosystem: context.committed.snapshot.ecosystem,
          payload: payload.value,
          source: {
            moduleId: operation.issuer.moduleId as string,
            instanceId: operation.issuer.instanceId as string,
          },
          interactionId: envelope.interactionId as string,
          logicalTime: context.committed.logicalTime,
          ecosystemRevision,
        });
      } catch {
        abortIntegrity(operation, operation.issuer.moduleId);
      }
      if (reduction.idempotent === true) {
        recordSettlement(context, operation.sequence, operation.settle, simulatorOk({
          interactionId: envelope.interactionId as string,
          ecosystemRevision: context.committed.revision,
          eventId: null,
          idempotent: true,
        }));
        return true;
      }
      const ecosystem = freezeJsonValue(assertJsonValue(reduction.ecosystem));
      const targetPayload = freezeJsonValue(assertJsonValue(reduction.targetPayload));
      for (const target of declaration.targets) {
        const registration = context.catalog.command(target.commandType);
        if (!registration || !validateSchema(registration.payloadSchema, targetPayload).ok) {
          abortIntegrity(operation, target.moduleId);
        }
      }
      let shell = context.committed.snapshot.shell;
      let instances = context.committed.snapshot.instances as unknown as JsonValue;
      if (reduction.product !== undefined) {
        const applied = applyInteractionProductEffects(context, reduction.product, operation.operationId);
        shell = applied.shell;
        instances = applied.instances;
      }
      context.committed = freezeCommittedState({
        ...context.committed,
        snapshot: {
          ...context.committed.snapshot,
          ecosystem,
          shell,
          instances: instances as unknown as typeof context.committed.snapshot.instances,
        },
        revision: ecosystemRevision,
      });
      const eventSequence = context.allocators.evt.next();
      const event: SimulatorEventRecord = Object.freeze({
        eventId: formatCanonicalId(context.epoch, 'evt', eventSequence),
        sequence: eventSequence,
        epoch: context.epoch,
        fullType: declaration.type,
        ownerModuleId: 'simulator',
        payload: targetPayload,
        causationOperationId: operation.operationId,
      });
      context.eventLog.push(event);
      notifyStateSubscribers(context);
      enqueueStage({
        epoch: context.epoch,
        declaration,
        targetIndex: 0,
        payload: targetPayload,
      }, operation.operationId);
      recordSettlement(context, operation.sequence, operation.settle, simulatorOk({
        interactionId: envelope.interactionId as string,
        ecosystemRevision,
        eventId: event.eventId,
      }));
      return true;
    },
    clearEpoch(epoch: number): void {
      for (const [operationId, stage] of pending) {
        if (stage.epoch === epoch) pending.delete(operationId);
      }
    },
    clearAll(): void {
      pending.clear();
    },
    hasPending(): boolean {
      return pending.size > 0;
    },
    register(context: EngineContext): void {
      registerInteractionCommand(context);
    },
  });
}
