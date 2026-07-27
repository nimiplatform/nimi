/**
 * Simulator State Engine composition root: queue acceptance, the synchronous
 * drain, session integrity failure, and the public engine surface.
 *
 * Authority: P-SIM-010..015, P-SIM-019;
 * tables/simulator-state-engine-policy.yaml.
 *
 * This module is pure TypeScript: it never reads wall-clock time, host
 * randomness, timers, DOM, or network. Hosts inject every effect.
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
  type SimulatorResult,
} from './errors.ts';
import { formatCanonicalId } from './ids.ts';
import { validateSchema, type SimulatorSchema } from './schema.ts';
import type { SimulatorAsyncReservationHandle } from './reservations.ts';
import type { SimulatorStreamTerminal } from './streams.ts';
import type {
  SimulatorIssuer,
  SimulatorModuleBehavior,
  SimulatorModuleCatalogDeclaration,
} from './types.ts';
import {
  INTERNAL,
  SIMULATOR_MAX_OPERATIONS_PER_DRAIN,
  SimulatorIntegrityAbort,
  freezeInstancePresentation,
  isThenable,
  type QueuedOperation,
  type SimulatorStateEngine,
  type SimulatorStateEngineOptions,
  type SimulatorStreamHandle,
} from './engine-types.ts';
import {
  createEngineContext,
  flushSettlements,
  instancesInCreationOrder,
  recordSettlement,
  sharedProjectionFor,
  type EngineContext,
} from './engine-context.ts';
import {
  attributeStreamFailure,
  processModuleCommand,
} from './module-commands.ts';
import {
  processInternalCommand,
  processQuery,
  registerInternalCommands,
} from './internal-commands.ts';
import { settleActiveResetForTerminal } from './reset.ts';
import {
  admitsReservationCaller,
  admitOperationCaller,
  beginEventPrepareWindow,
  subscribePreparedEvent,
  validateLiveIssuer,
} from './caller-admission.ts';
import { registerStreamMethod } from './stream-methods.ts';
import { createInteractionRuntime } from './interactions.ts';
import { isSimulatorRouteState } from './route-state.ts';

export {
  SIMULATOR_MAX_OPERATIONS_PER_DRAIN,
  type SimulatorStateEngine,
  type SimulatorStateEngineOptions,
};
export function createSimulatorStateEngine(options: SimulatorStateEngineOptions): SimulatorStateEngine {
  const interactions = createInteractionRuntime(options.interactions, enqueueInternal);
  const context: EngineContext = createEngineContext(options, {
    onModuleCommandCommitted(operation, moduleId, events) {
      interactions.onModuleCommandCommitted(context, operation, moduleId, events);
    },
    onResetLinearization: interactions.clearEpoch,
    onReservationRelease(record, outcome) {
      const settlement = accept(record.commandType, outcome, record.issuer, record.causationId, {
        derived: true,
        kind: 'command',
      });
      const forward = context.reservationResultSinks.get(record.reservationId);
      if (forward) {
        context.reservationResultSinks.delete(record.reservationId);
        void settlement.then((result) => {
          context.callbackRunning = true;
          try {
            const returned = forward(result) as unknown;
            if (isThenable(returned)) {
              void Promise.resolve(returned).catch(() => undefined);
              attributeReservationCallbackFailure(record.issuer);
            }
          } catch {
            attributeReservationCallbackFailure(record.issuer);
          } finally {
            context.callbackRunning = false;
          }
        }).catch(() => {
          try {
            attributeReservationCallbackFailure(record.issuer);
          } catch {
            // Integrity termination linearizes before host notification; a
            // throwing host hook must not create an unhandled rejection.
          }
        });
      }
    },
    onStreamItem(streamId, item) {
      const handle = context.streamHandles.get(streamId);
      if (!handle?.observer) return;
      context.callbackRunning = true;
      try {
        const returned = handle.observer(item);
        if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
          attributeStreamFailure(context, streamId);
        }
      } catch {
        attributeStreamFailure(context, streamId);
      } finally {
        context.callbackRunning = false;
      }
    },
    onStreamTerminal(streamId, terminal) {
      const handle = context.streamHandles.get(streamId);
      const record = context.streams.get(streamId);
      if (handle) {
        context.streamHandles.delete(streamId);
        if (context.resetTerminalCapture) {
          // Defer exposure until the reset barrier's ordered terminal phase.
          context.resetTerminalCapture.push({
            kind: 'stream',
            sequence: record?.allocationSequence ?? Number.MAX_SAFE_INTEGER,
            settle: () => handle.resolveCompletion(terminal),
          });
        } else {
          handle.resolveCompletion(terminal);
        }
      }
    },
  });

  function attributeReservationCallbackFailure(issuer: SimulatorIssuer): void {
    if (issuer.kind === 'instance' && issuer.instanceId) {
      try {
        context.hooks.requestInstanceFailure?.(issuer.instanceId, 'reservation-settlement-callback-failure');
      } catch {
        failSessionIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
          moduleId: issuer.moduleId,
          instanceId: issuer.instanceId,
        }), null);
      }
      return;
    }
    failSessionIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
      moduleId: issuer.moduleId,
      instanceId: issuer.instanceId,
    }), null);
  }

  // -------------------------------------------------------------------------
  // Queue acceptance
  // -------------------------------------------------------------------------

  function enqueueInternal(type: string, payload: JsonValue, issuer: SimulatorIssuer, causationId: string | null): string | null {
    return acceptWithIdentity(type, payload, issuer, causationId, { derived: true, kind: 'command' }).operationId;
  }

  function acceptWithIdentity(
    type: string,
    payload: JsonValue,
    issuer: SimulatorIssuer,
    causationId: string | null,
    options: { readonly derived?: boolean; readonly kind: 'command' | 'query' },
  ): { readonly operationId: string | null; readonly settlement: Promise<SimulatorResult<JsonValue>> } {
    const reject = (error: import('./errors.ts').SimulatorError) => ({
      operationId: null,
      settlement: Promise.resolve(simulatorFail<JsonValue>(error)),
    });
    if (context.phase === 'terminal') {
      return reject(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
        moduleId: issuer.moduleId, instanceId: issuer.instanceId,
      }));
    }
    if (context.phase === 'resetting') {
      return reject(simulatorError('SIMULATOR_STALE_EPOCH', {
        moduleId: issuer.moduleId, instanceId: issuer.instanceId,
      }));
    }
    const kind = options.kind;
    const registration = kind === 'command' ? context.catalog.command(type) : context.catalog.query(type);
    if (!registration) {
      return reject(simulatorError('SIMULATOR_UNSUPPORTED', {
        moduleId: issuer.moduleId, instanceId: issuer.instanceId,
      }));
    }
    const schema = kind === 'command'
      ? (registration as { payloadSchema: SimulatorSchema }).payloadSchema
      : (registration as { inputSchema: SimulatorSchema }).inputSchema;
    const validation = validateSchema(schema, payload);
    if (!validation.ok) {
      return reject(simulatorError('SIMULATOR_INVALID_PAYLOAD', {
        moduleId: issuer.moduleId, instanceId: issuer.instanceId,
      }));
    }
    const admissionError = admitOperationCaller(context, {
      kind,
      type,
      payload: validation.value,
      issuer,
      owner: registration.owner,
    });
    if (admissionError) return reject(admissionError);
    const interactionError = interactions.admitBeforeQueue(context, type, validation.value, issuer);
    if (interactionError) return reject(interactionError);
    if (kind === 'command' && (type === INTERNAL.instanceOpen || type === INTERNAL.instanceRoute)) {
      const input = validation.value as Readonly<Record<string, JsonValue>>;
      const route = (type === INTERNAL.instanceOpen ? input.initialRoute : input.route) as JsonValue;
      if (!isSimulatorRouteState(route)) {
        return reject(simulatorError('SIMULATOR_INVALID_PAYLOAD', {
          moduleId: issuer.moduleId,
          instanceId: issuer.instanceId,
        }));
      }
    }
    let sequence: number;
    try {
      sequence = context.allocators.op.next();
    } catch {
      return reject(simulatorError('SIMULATOR_RESOURCE_EXHAUSTED', {
        moduleId: issuer.moduleId, instanceId: issuer.instanceId,
      }));
    }
    const operationId = formatCanonicalId(context.epoch, 'op', sequence);
    let settleFn: (result: SimulatorResult<JsonValue>) => void = () => undefined;
    const promise = new Promise<SimulatorResult<JsonValue>>((resolve) => {
      settleFn = resolve;
    });
    const operation: QueuedOperation = {
      operationId,
      sequence,
      epoch: context.epoch,
      kind,
      type,
      payload: validation.value,
      issuer,
      causationId,
      derived: options.derived === true,
      settle: settleFn,
    };
    context.queue.push(operation);
    if (!context.draining) drain();
    return { operationId, settlement: promise };
  }

  function accept(
    type: string,
    payload: JsonValue,
    issuer: SimulatorIssuer,
    causationId: string | null,
    options: { readonly derived?: boolean; readonly kind: 'command' | 'query' },
  ): Promise<SimulatorResult<JsonValue>> {
    return acceptWithIdentity(type, payload, issuer, causationId, options).settlement;
  }

  // -------------------------------------------------------------------------
  // Drain: one synchronous FIFO turn to quiescence, never an await inside.
  // -------------------------------------------------------------------------

  function drain(): void {
    if (context.draining) return;
    context.draining = true;
    context.operationsThisDrain = 0;
    try {
      while (context.queue.length > 0) {
        if (context.operationsThisDrain >= context.maxOperationsPerDrain) {
          failSessionIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'), null);
          return;
        }
        const operation = context.queue.shift() as QueuedOperation;
        context.operationsThisDrain += 1;
        try {
          processOperation(operation);
        } catch (error) {
          if (error instanceof SimulatorIntegrityAbort) {
            failSessionIntegrity(error.error, operation);
            return;
          }
          failSessionIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
            moduleId: operation.issuer.moduleId,
            instanceId: operation.issuer.instanceId,
            operationId: operation.operationId,
          }), operation);
          return;
        }
        if (context.phase !== 'open') {
          // Reset linearization ended the old drain; the tail is detached.
          return;
        }
        // Due clock jobs enqueue before quiescence can be reported.
        const due = context.clock.collectDue(context.committed.logicalTime);
        for (const job of due) {
          enqueueInternal(job.command.type, job.command.payload, {
            kind: job.command.issuerInstanceId ? 'instance' : 'shell',
            moduleId: job.command.issuerModuleId,
            instanceId: job.command.issuerInstanceId,
          }, job.command.causationId);
        }
      }
      if (interactions.hasPending()) {
        failSessionIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'), null);
      }
    } finally {
      context.draining = false;
      flushSettlements(context);
    }
  }

  function failSessionIntegrity(error: import('./errors.ts').SimulatorError, current: QueuedOperation | null): void {
    if (context.phase === 'terminal') return;
    interactions.clearAll();
    context.phase = 'terminal';
    context.terminalError = error;
    const remainder = current ? [current, ...context.queue] : context.queue.slice();
    context.queue = [];
    for (const entry of remainder) {
      recordSettlement(context, entry.sequence, entry.settle, simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
        moduleId: entry.issuer.moduleId,
        instanceId: entry.issuer.instanceId,
        operationId: entry.operationId,
      })));
    }
    // A terminal session cannot retain host-visible asynchronous resources.
    // Streams settle failed in allocation order; jobs and reservations become
    // terminal without releasing any new State Engine command.
    for (const stream of context.streams.records()) {
      if (stream.status !== 'terminal') context.streams.fail(stream.streamId);
    }
    context.clock.cancelAll();
    context.pump.cancelAll('dispose');
    context.reservationResultSinks.clear();
    try {
      context.hooks.invalidateEpoch?.(context.epoch, context.epoch);
    } finally {
      settleActiveResetForTerminal(context, context.terminalError);
      context.hooks.onSessionTerminal?.(context.terminalError);
    }
  }

  function processOperation(operation: QueuedOperation): void {
    if (operation.epoch !== context.epoch) {
      recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_STALE_EPOCH', {
        moduleId: operation.issuer.moduleId,
        instanceId: operation.issuer.instanceId,
        operationId: operation.operationId,
      })));
      return;
    }
    if (operation.kind === 'query') {
      processQuery(context, operation);
      return;
    }
    interactions.assertExpectedDerived(context, operation);
    const registration = context.catalog.command(operation.type);
    if (!registration) {
      recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_UNSUPPORTED', {
        moduleId: operation.issuer.moduleId, instanceId: operation.issuer.instanceId, operationId: operation.operationId,
      })));
      return;
    }
    for (const capability of registration.requiredCapabilities) {
      if (!context.capabilities.has(capability)) {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_CAPABILITY_DENIED', {
          moduleId: operation.issuer.moduleId, instanceId: operation.issuer.instanceId, operationId: operation.operationId,
        })));
        return;
      }
    }
    if (registration.owner.kind === 'module') {
      processModuleCommand(context, operation, registration.owner.moduleId);
      return;
    }
    if (interactions.process(context, operation)) return;
    processInternalCommand(context, operation);
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  registerInternalCommands(context);
  interactions.register(context);

  const engine: SimulatorStateEngine = {
    get epoch() {
      return context.epoch;
    },
    get phase() {
      return context.phase;
    },
    terminateIntegrity(error) {
      failSessionIntegrity(error, null);
      if (!context.draining) flushSettlements(context);
    },
    get streamRegistry() {
      return context.streams;
    },
    registerModuleCatalog(declaration: SimulatorModuleCatalogDeclaration) {
      if (context.phase !== 'open' || context.committed.revision !== 0 || context.queue.length > 0) {
        throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId: declaration.moduleId }));
      }
      if (context.moduleCatalogs.has(declaration.moduleId)) {
        throw new SimulatorIntegrityAbort(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId: declaration.moduleId }));
      }
      context.moduleCatalogs.set(declaration.moduleId, declaration);
      for (const [type, payloadSchema] of Object.entries(declaration.commandSchemas)) {
        context.catalog.registerCommand({
          kind: 'command',
          type,
          owner: { kind: 'module', moduleId: declaration.moduleId },
          payloadSchema,
          writeSet: ['modules'],
          requiredCapabilities: [],
        });
      }
      for (const [type, query] of Object.entries(declaration.queries)) {
        context.catalog.registerQuery({
          kind: 'query',
          type,
          owner: { kind: 'module', moduleId: declaration.moduleId },
          inputSchema: query.inputSchema,
          projectionSchema: query.projectionSchema,
        });
      }
    },
    attachModuleBehavior(moduleId: string, behavior: SimulatorModuleBehavior) {
      if (context.phase !== 'open') {
        return simulatorFail(simulatorError(
          context.phase === 'resetting' ? 'SIMULATOR_STALE_EPOCH' : 'SIMULATOR_INTEGRITY_FAILURE',
          { moduleId },
        ));
      }
      if (
        context.draining
        || context.callbackRunning
        || context.queue.length > 0
        || !context.moduleCatalogs.has(moduleId)
        || context.moduleBehaviors.has(moduleId)
      ) {
        return simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId }));
      }
      context.moduleBehaviors.set(moduleId, behavior);
      return simulatorOk({ attached: true as const });
    },
    projectInstance(instanceId: string) {
      const instance = context.committed.snapshot.instances[instanceId];
      if (!instance || instance.status === 'disposed' || instance.status === 'disposing') {
        return simulatorFail(simulatorError('SIMULATOR_INSTANCE_DISPOSED', { instanceId }));
      }
      const behavior = context.moduleBehaviors.get(instance.moduleId);
      const moduleState = context.committed.snapshot.modules[instance.moduleId];
      if (!behavior || moduleState === undefined) {
        return simulatorFail(simulatorError('SIMULATOR_MODULE_FAILED', {
          moduleId: instance.moduleId,
          instanceId,
        }));
      }
      try {
        const projection = behavior.project(moduleState, {
          instanceId,
          surfaceId: instance.surfaceId,
          route: instance.route,
          sharedProjection: sharedProjectionFor(context, instance.moduleId),
        });
        return simulatorOk(freezeJsonValue(assertJsonValue(projection)));
      } catch {
        return simulatorFail(simulatorError('SIMULATOR_INSTANCE_FAILED', {
          moduleId: instance.moduleId,
          instanceId,
        }));
      }
    },
    registerStreamMethod(declaration) {
      registerStreamMethod(context, declaration);
    },
    setCapabilities(next) {
      context.capabilities = next;
    },
    acceptCommand(type, payload, issuer, causationId = null, acceptOptions = {}) {
      return accept(type, payload, issuer, causationId, { kind: 'command', derived: acceptOptions.derived === true });
    },
    acceptQuery(type, input, issuer) {
      return accept(type, input, issuer, null, { kind: 'query' });
    },
    reserveAsync(input) {
      if (context.phase === 'terminal') {
        return simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
          moduleId: input.issuer.moduleId, instanceId: input.issuer.instanceId,
        }));
      }
      if (context.phase === 'resetting') {
        return simulatorFail(simulatorError('SIMULATOR_STALE_EPOCH', {
          moduleId: input.issuer.moduleId, instanceId: input.issuer.instanceId,
        }));
      }
      const issuerError = validateLiveIssuer(context, input.issuer);
      if (issuerError) return simulatorFail(issuerError);
      const commandRegistration = context.catalog.command(input.commandType);
      if (!commandRegistration) {
        return simulatorFail(simulatorError('SIMULATOR_UNSUPPORTED', {
          moduleId: input.issuer.moduleId, instanceId: input.issuer.instanceId,
        }));
      }
      if (!admitsReservationCaller(commandRegistration.owner, input.issuer)) {
        return simulatorFail(simulatorError('SIMULATOR_CAPABILITY_DENIED', {
          moduleId: input.issuer.moduleId,
          instanceId: input.issuer.instanceId,
        }));
      }
      // The outcome schema is the captured command-payload schema itself:
      // one catalog truth, never a second caller-supplied shape.
      const outcomeSchema = commandRegistration.payloadSchema;
      let reservationSequence: number;
      try {
        reservationSequence = context.allocators.asyncReservation.next();
      } catch {
        return simulatorFail(simulatorError('SIMULATOR_RESOURCE_EXHAUSTED', {
          moduleId: input.issuer.moduleId, instanceId: input.issuer.instanceId,
        }));
      }
      const reservationId = formatCanonicalId(context.epoch, 'async', reservationSequence);
      const reservationEpoch = context.epoch;
      const handle = context.pump.reserve({
        reservationId,
        epoch: context.epoch,
        issuer: input.issuer,
        causationId: input.causationId,
        commandType: input.commandType,
        outcomeSchemaId: input.outcomeSchemaId,
        outcomeSchema,
      });
      if (input.onCommandSettlement) {
        context.reservationResultSinks.set(reservationId, input.onCommandSettlement);
      }
      return simulatorOk(Object.freeze({
        reservationId,
        settle(outcome: JsonValue) {
          // Epoch invalidation closes acceptance synchronously; the reset
          // barrier still owns the allocation-ordered terminal cancellation.
          if (context.epoch !== reservationEpoch || context.phase !== 'open') {
            return simulatorOk({ accepted: false });
          }
          return handle.settle(outcome);
        },
        cancel(reason: 'caller' | 'dispose' | 'reset') {
          if (context.epoch !== reservationEpoch || context.phase !== 'open') {
            return simulatorOk({ cancelled: false });
          }
          const result = handle.cancel(reason);
          if (result.ok && result.value.cancelled) {
            context.reservationResultSinks.delete(reservationId);
          }
          return result;
        },
      }));
    },
    cancelAsyncReservationsForInstance(instanceId) {
      const cancelled = context.pump.cancelAllForInstance(instanceId, 'dispose');
      for (const record of cancelled) {
        context.reservationResultSinks.delete(record.reservationId);
      }
    },
    cancelStreamsForInstance(instanceId) {
      context.streams.cancelAllForInstance(instanceId);
    },
    subscribeState(listener) {
      context.stateSubscriberSequence += 1;
      const entry = { sequence: context.stateSubscriberSequence, listener };
      context.stateSubscribers.push(entry);
      return () => {
        context.stateSubscribers = context.stateSubscribers.filter((subscriber) => subscriber !== entry);
      };
    },
    beginPrepareWindow(instanceId) {
      return beginEventPrepareWindow(context, instanceId);
    },
    subscribeEvent(windowObject, eventType, handler) {
      return subscribePreparedEvent(context, windowObject, eventType, handler);
    },
    attachStream(streamId) {
      const result = context.streams.attach(streamId);
      return simulatorOk(result);
    },
    streamObserverFailure(streamId) {
      attributeStreamFailure(context, streamId);
    },
    streamHandle(streamId) {
      const record = context.streams.get(streamId);
      const handle = context.streamHandles.get(streamId);
      if (!record || !handle || record.epoch !== context.epoch || record.status === 'terminal') {
        return null;
      }
      return Object.freeze({
        streamId,
        attach(observer: (item: JsonValue) => unknown): SimulatorResult<{ readonly attached: boolean }> {
          const attached = context.streams.attach(streamId);
          if (attached.attached) {
            handle.observer = observer;
          }
          return simulatorOk(attached);
        },
        completion: handle.completion,
      });
    },
    getCommitted() {
      const committed = context.committed;
      const epoch = context.epoch;
      return Object.freeze({
        epoch,
        revision: committed.revision,
        logicalTime: committed.logicalTime,
        random: committed.random,
        partitions: Object.freeze({
          scenario: committed.snapshot.scenario,
          ecosystem: committed.snapshot.ecosystem,
          shell: committed.snapshot.shell,
          instances: committed.snapshot.instances as unknown as JsonValue,
          modules: committed.snapshot.modules as unknown as JsonValue,
        }),
        instance(instanceId: string) {
          const instance = committed.snapshot.instances[instanceId];
          return instance ? freezeInstancePresentation(instanceId, instance) : null;
        },
        instancesInCreationOrder() {
          return instancesInCreationOrder(committed);
        },
      });
    },
    isQuiescent() {
      return (
        context.phase === 'open'
        && context.queue.length === 0
        && !context.draining
        && !context.callbackRunning
        && context.clock.collectDuePreview(context.committed.logicalTime).length === 0
        && !context.pump.hasImmediatelyReleasable()
        && !interactions.hasPending()
      );
    },
    allocateReadinessId() {
      if (context.phase !== 'open') {
        return simulatorFail(simulatorError(context.phase === 'resetting' ? 'SIMULATOR_STALE_EPOCH' : 'SIMULATOR_INTEGRITY_FAILURE'));
      }
      try {
        return simulatorOk({ readinessId: formatCanonicalId(context.epoch, 'ready', context.allocators.ready.next()) });
      } catch {
        return simulatorFail(simulatorError('SIMULATOR_RESOURCE_EXHAUSTED'));
      }
    },
  };

  return engine;
}

// Re-export shared engine types so consumers have one entry point.
export type {
  SimulatorPrepareWindow,
  SimulatorStreamHandle,
  SimulatorStreamMethodDeclaration,
  SimulatorStateEngineHooks,
} from './engine-types.ts';
export type { SimulatorStreamTerminal };
