/**
 * Module command transactions: atomic reduction, commit, and the fixed
 * notification order (subscribers, events, stream delivery).
 *
 * Authority: P-SIM-011; tables/simulator-state-engine-policy.yaml
 * `transaction` and `notification_order`.
 */

import {
  assertJsonValue,
  freezeJsonValue,
  type JsonValue,
} from './json-value.ts';
import {
  simulatorError,
  simulatorFail,
  simulatorOk,
  type SimulatorError,
} from './errors.ts';
import {
  drawSimulatorRandom,
  simulatorRandomFromSnapshot,
  simulatorRandomToSnapshot,
} from './random.ts';
import { formatCanonicalId } from './ids.ts';
import { validateSchema } from './schema.ts';
import {
  SIMULATOR_PROTOCOL_OPERATION,
  type SimulatorCommandEnvelope,
  type SimulatorDeclaredEvent,
  type SimulatorEventRecord,
} from './types.ts';
import {
  SimulatorIntegrityAbort,
  isThenable,
  type QueuedOperation,
} from './engine-types.ts';
import {
  freezeCommittedState,
  recordSettlement,
  sharedProjectionFor,
  type EngineContext,
} from './engine-context.ts';

export function abortIntegrity(error: SimulatorError): never {
  throw new SimulatorIntegrityAbort(error);
}

export function notifyStateSubscribers(context: EngineContext): void {
  const subscribers = [...context.stateSubscribers].sort((left, right) => left.sequence - right.sequence);
  for (const subscriber of subscribers) {
    context.callbackRunning = true;
    try {
      const returned = subscriber.listener(context.committed.revision);
      if (isThenable(returned)) {
        abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
      }
    } catch (error) {
      if (error instanceof SimulatorIntegrityAbort) throw error;
      abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
    } finally {
      context.callbackRunning = false;
    }
  }
}

export function deliverEvent(context: EngineContext, event: SimulatorEventRecord): void {
  const targets = context.eventSubscribers
    .filter((subscriber) => subscriber.eventType === event.fullType)
    .sort((left, right) => (
      (left.moduleOrderingKey - right.moduleOrderingKey)
      || (left.instanceCreationSequence - right.instanceCreationSequence)
      || (left.subscriptionSequence - right.subscriptionSequence)
    ));
  const failedInstances = new Set<string>();
  for (const target of targets) {
    if (target.subscriberInstanceId) {
      if (failedInstances.has(target.subscriberInstanceId)) continue;
      const subscriberInstance = context.committed.snapshot.instances[target.subscriberInstanceId];
      if (
        !subscriberInstance
        || subscriberInstance.status === 'disposing'
        || subscriberInstance.status === 'disposed'
        || subscriberInstance.status === 'failed'
      ) {
        continue;
      }
    }
    context.callbackRunning = true;
    try {
      const returned = target.handler(event.payload, event);
      if (isThenable(returned)) {
        throw new Error('async event handler');
      }
    } catch {
      if (target.subscriberInstanceId) {
        failedInstances.add(target.subscriberInstanceId);
        context.hooks.requestInstanceFailure?.(target.subscriberInstanceId, 'event-handler-failure');
      } else {
        abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId: target.subscriberModuleId }));
      }
    } finally {
      context.callbackRunning = false;
    }
  }
  context.streams.deliverEvent(event.fullType, event.payload);
}

export function attributeStreamFailure(context: EngineContext, streamId: string): void {
  const record = context.streams.get(streamId);
  context.streams.fail(streamId);
  if (record && record.ownerInstanceId && context.hooks.requestInstanceFailure) {
    context.hooks.requestInstanceFailure(record.ownerInstanceId, 'stream-observer-failure');
  } else {
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
      moduleId: record?.ownerModuleId ?? null,
      instanceId: record?.ownerInstanceId ?? null,
    }));
  }
}

export function processModuleCommand(
  context: EngineContext,
  operation: QueuedOperation,
  moduleId: string,
): void {
  const declaration = context.moduleCatalogs.get(moduleId);
  const behavior = context.moduleBehaviors.get(moduleId);
  const moduleState = context.committed.snapshot.modules[moduleId];
  if (!declaration || !behavior || moduleState === undefined) {
    recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_MODULE_FAILED', {
      moduleId, instanceId: operation.issuer.instanceId, operationId: operation.operationId,
    })));
    return;
  }
  const envelope: SimulatorCommandEnvelope = {
    protocol: SIMULATOR_PROTOCOL_OPERATION,
    kind: 'command',
    type: operation.type,
    payload: operation.payload,
    epoch: operation.epoch,
    sequence: operation.sequence,
    operationId: operation.operationId,
    issuer: operation.issuer,
    causationId: operation.causationId,
  };
  const randomDraft = simulatorRandomFromSnapshot(context.committed.random);
  let drawInvalidated = false;
  const contextView = {
    now: context.committed.logicalTime,
    sharedProjection: sharedProjectionFor(context, moduleId),
    drawRandom(): number {
      if (drawInvalidated) {
        throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId }));
      }
      return drawSimulatorRandom(randomDraft);
    },
  };
  let reduction;
  try {
    reduction = behavior.reduce(moduleState, envelope, contextView);
  } catch (error) {
    if (error instanceof SimulatorIntegrityAbort) throw error;
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
      moduleId, instanceId: operation.issuer.instanceId, operationId: operation.operationId,
    }));
    return;
  } finally {
    drawInvalidated = true;
  }
  if (!reduction || typeof reduction !== 'object' || !Array.isArray(reduction.events)) {
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId, operationId: operation.operationId }));
    return;
  }
  let nextModuleState: JsonValue;
  try {
    nextModuleState = assertJsonValue(reduction.state);
  } catch {
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId, operationId: operation.operationId }));
    return;
  }
  const events: SimulatorDeclaredEvent[] = [];
  for (const event of reduction.events) {
    if (!event || typeof event.type !== 'string' || !Object.hasOwn(declaration.eventSchemas, event.type)) {
      abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId, operationId: operation.operationId }));
      return;
    }
    const validation = validateSchema(declaration.eventSchemas[event.type], event.payload);
    if (!validation.ok) {
      abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId, operationId: operation.operationId }));
      return;
    }
    events.push({ type: event.type, payload: validation.value });
  }
  // Atomic commit: snapshot + one revision + ordered events + random draft.
  const nextModules = { ...context.committed.snapshot.modules, [moduleId]: freezeJsonValue(nextModuleState) };
  context.committed = freezeCommittedState({
    ...context.committed,
    snapshot: { ...context.committed.snapshot, modules: nextModules },
    revision: context.committed.revision + 1,
    random: simulatorRandomToSnapshot(randomDraft),
  });
  const published: SimulatorEventRecord[] = events.map((event) => {
    const sequence = context.allocators.evt.next();
    return Object.freeze({
      eventId: formatCanonicalId(context.epoch, 'evt', sequence),
      sequence,
      epoch: context.epoch,
      fullType: event.type,
      ownerModuleId: moduleId,
      payload: event.payload,
      causationOperationId: operation.operationId,
    });
  });
  context.eventLog.push(...published);
  notifyStateSubscribers(context);
  for (const event of published) {
    deliverEvent(context, event);
  }
  context.wiring.onModuleCommandCommitted(operation, moduleId, published);
  recordSettlement(context, operation.sequence, operation.settle, simulatorOk({
    revision: context.committed.revision,
    eventIds: published.map((event) => event.eventId),
  }));
}
