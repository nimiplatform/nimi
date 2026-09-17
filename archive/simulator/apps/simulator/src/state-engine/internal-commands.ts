/**
 * Simulator-internal command catalog and handlers: clock, streams, behavior
 * activation, instance lifecycle, readiness settlement, and scenario reset
 * entry — each with one declared owner and closed write set.
 *
 * Authority: .nimi/spec/platform/simulator.authority.yaml.
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
} from './errors.ts';
import { formatCanonicalId } from './ids.ts';
import { validateSchema, type SimulatorSchema } from './schema.ts';
import type { SimulatorRouteState } from './types.ts';
import {
  INSTANCE_TRANSITIONS,
  INTERNAL,
  QUERY_COMMITTED,
  SimulatorIntegrityAbort,
  type QueuedOperation,
} from './engine-types.ts';
import {
  freezeCommittedState,
  recordSettlement,
  sharedProjectionFor,
  type EngineContext,
} from './engine-context.ts';
import {
  abortIntegrity,
  notifyStateSubscribers,
} from './module-commands.ts';
import { beginResetLinearization } from './reset.ts';
import { processOverlayCommand, registerOverlayCommands } from './overlay-state.ts';
import {
  processProductCommand,
  registerProductCommands,
} from './product-state.ts';
import { isSimulatorRouteState } from './route-state.ts';

const INTEGER_SCHEMA: SimulatorSchema = { kind: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const JOB_ID_SCHEMA: SimulatorSchema = { kind: 'string', pattern: /^[0-9]+:job:[0-9]+$/, minLength: 1 };
const STREAM_ID_SCHEMA: SimulatorSchema = { kind: 'string', pattern: /^[0-9]+:stream:[0-9]+$/, minLength: 1 };
const MODULE_ID_SCHEMA: SimulatorSchema = { kind: 'string', minLength: 1 };
const INSTANCE_ID_SCHEMA: SimulatorSchema = { kind: 'string', pattern: /^[0-9]+:instance:[0-9]+$/, minLength: 1 };
const ROUTE_SCHEMA: SimulatorSchema = {
  kind: 'object',
  properties: {
    pathname: { kind: 'string' },
    search: {
      kind: 'array',
      items: { kind: 'object', properties: { key: { kind: 'string' }, value: { kind: 'string' } } },
    },
    fragment: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'string' }] },
  },
};

export function registerInternalCommands(context: EngineContext): void {
  const { catalog } = context;
  const scenarioOwner = { kind: 'scenario' } as const;
  const shellOwner = { kind: 'shell' } as const;
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.clockAdvanceBy, owner: scenarioOwner,
    payloadSchema: { kind: 'object', properties: { deltaMs: INTEGER_SCHEMA } },
    writeSet: ['scenario'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.clockAdvanceTo, owner: scenarioOwner,
    payloadSchema: { kind: 'object', properties: { targetMs: INTEGER_SCHEMA } },
    writeSet: ['scenario'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.clockSchedule, owner: shellOwner,
    payloadSchema: {
      kind: 'object',
      properties: {
        commandType: MODULE_ID_SCHEMA,
        payload: { kind: 'json' },
        causationId: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'string' }] },
        delayMs: INTEGER_SCHEMA,
      },
    },
    writeSet: ['shell'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.clockCancelJob, owner: shellOwner,
    payloadSchema: { kind: 'object', properties: { jobId: JOB_ID_SCHEMA } },
    writeSet: ['shell'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.streamOpen, owner: shellOwner,
    payloadSchema: {
      kind: 'object',
      properties: {
        methodId: MODULE_ID_SCHEMA,
        ownerInstanceId: { kind: 'union', variants: [{ kind: 'null' }, INSTANCE_ID_SCHEMA] },
      },
    },
    writeSet: ['shell'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.streamActivate, owner: shellOwner,
    payloadSchema: { kind: 'object', properties: { streamId: STREAM_ID_SCHEMA } },
    writeSet: ['shell'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.streamCancel, owner: shellOwner,
    payloadSchema: {
      kind: 'object',
      properties: {
        streamId: STREAM_ID_SCHEMA,
        reason: { kind: 'stringEnum', values: ['caller', 'detach', 'dispose'] },
      },
    },
    writeSet: ['shell'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.behaviorActivate, owner: shellOwner,
    payloadSchema: { kind: 'object', properties: { moduleId: MODULE_ID_SCHEMA } },
    writeSet: ['modules'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.instanceOpen, owner: shellOwner,
    payloadSchema: {
      kind: 'object',
      properties: {
        moduleId: MODULE_ID_SCHEMA,
        surfaceId: MODULE_ID_SCHEMA,
        initialRoute: ROUTE_SCHEMA,
      },
    },
    writeSet: ['instances'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.instanceTransition, owner: shellOwner,
    payloadSchema: {
      kind: 'object',
      properties: {
        instanceId: INSTANCE_ID_SCHEMA,
        transition: { kind: 'stringEnum', values: ['module_loaded', 'prepare_success', 'activate', 'deactivate', 'attributable_failure', 'dispose', 'open'] },
      },
    },
    writeSet: ['instances'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.instanceDisposed, owner: shellOwner,
    payloadSchema: { kind: 'object', properties: { instanceId: INSTANCE_ID_SCHEMA } },
    writeSet: ['instances'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.instanceRoute, owner: shellOwner,
    payloadSchema: {
      kind: 'object',
      properties: {
        instanceId: INSTANCE_ID_SCHEMA,
        route: ROUTE_SCHEMA,
      },
    },
    writeSet: ['instances'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.readinessSettle, owner: shellOwner,
    payloadSchema: {
      kind: 'object',
      properties: {
        readinessId: { kind: 'string', pattern: /^[0-9]+:ready:[0-9]+$/ },
        surfaceId: { kind: 'string', minLength: 1 },
        instanceId: INSTANCE_ID_SCHEMA,
        state: { kind: 'stringEnum', values: ['usable', 'cancelled', 'failed'] },
        reason: {
          kind: 'stringEnum',
          values: ['ready', 'dispose', 'reset', 'stale-epoch', 'state-change', 'instance-failure', 'module-failure', 'session-failure'],
        },
        markedAtLogicalTime: { kind: 'union', variants: [{ kind: 'null' }, INTEGER_SCHEMA] },
      },
    },
    writeSet: ['shell'], requiredCapabilities: [],
  });
  catalog.registerCommand({
    kind: 'command', type: INTERNAL.reset, owner: scenarioOwner,
    payloadSchema: { kind: 'object', properties: {} },
    writeSet: ['scenario', 'ecosystem', 'shell', 'instances', 'modules'], requiredCapabilities: [],
  });
  catalog.registerQuery({
    kind: 'query', type: QUERY_COMMITTED, owner: shellOwner,
    inputSchema: { kind: 'object', properties: {} },
    projectionSchema: { kind: 'json' },
  });
  registerOverlayCommands(context);
  registerProductCommands(context);
}

export function stateChanged(context: EngineContext, operation: QueuedOperation, value: JsonValue): void {
  context.committed = freezeCommittedState({
    ...context.committed,
    revision: context.committed.revision + 1,
  });
  notifyStateSubscribers(context);
  recordSettlement(context, operation.sequence, operation.settle, simulatorOk(value));
}

export function stateUnchanged(context: EngineContext, operation: QueuedOperation, value: JsonValue): void {
  recordSettlement(context, operation.sequence, operation.settle, simulatorOk(value));
}

export function processQuery(context: EngineContext, operation: QueuedOperation): void {
  const registration = context.catalog.query(operation.type);
  if (!registration) {
    recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_UNSUPPORTED', {
      moduleId: operation.issuer.moduleId, instanceId: operation.issuer.instanceId, operationId: operation.operationId,
    })));
    return;
  }
  let projection: JsonValue;
  try {
    if (registration.owner.kind === 'module') {
      const moduleState = context.committed.snapshot.modules[registration.owner.moduleId];
      if (moduleState === undefined) {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_MODULE_FAILED', {
          moduleId: registration.owner.moduleId, operationId: operation.operationId,
        })));
        return;
      }
      const declaration = context.moduleCatalogs.get(registration.owner.moduleId)?.queries[operation.type];
      if (!declaration) {
        abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId: registration.owner.moduleId }));
        return;
      }
      projection = declaration.select(moduleState, operation.payload);
    } else {
      projection = {
        epoch: context.epoch,
        revision: context.committed.revision,
        logicalTime: context.committed.logicalTime,
        drawCount: context.committed.random.drawCount,
      };
    }
    assertJsonValue(projection);
    const validation = validateSchema(registration.projectionSchema, projection);
    if (!validation.ok) {
      abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
        moduleId: registration.owner.kind === 'module' ? registration.owner.moduleId : null,
      }));
      return;
    }
    recordSettlement(context, operation.sequence, operation.settle, simulatorOk(validation.value));
  } catch (error) {
    if (error instanceof Error && error.name === 'SimulatorIntegrityAbort') throw error;
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
      moduleId: operation.issuer.moduleId, instanceId: operation.issuer.instanceId, operationId: operation.operationId,
    }));
  }
}

function processClockAdvance(context: EngineContext, operation: QueuedOperation, advance: () => number): void {
  try {
    const next = advance();
    context.committed = { ...context.committed, logicalTime: next };
    stateChanged(context, operation, { now: next, pendingJobs: context.clock.pendingJobCount });
  } catch (error) {
    if (error instanceof SimulatorIntegrityAbort) throw error;
    recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_INVALID_PAYLOAD', {
      moduleId: operation.issuer.moduleId, instanceId: operation.issuer.instanceId, operationId: operation.operationId,
    })));
  }
}

export function processInternalCommand(context: EngineContext, operation: QueuedOperation): void {
  if (processOverlayCommand(context, operation)) return;
  if (processProductCommand(context, operation)) return;
  const payload = operation.payload as Record<string, JsonValue>;
  const unsupported = () => recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_UNSUPPORTED', {
    moduleId: operation.issuer.moduleId, instanceId: operation.issuer.instanceId, operationId: operation.operationId,
  })));
  switch (operation.type) {
    case INTERNAL.clockAdvanceBy: {
      processClockAdvance(context, operation, () => context.clock.advanceBy(payload.deltaMs as number));
      return;
    }
    case INTERNAL.clockAdvanceTo: {
      processClockAdvance(context, operation, () => context.clock.advanceTo(payload.targetMs as number));
      return;
    }
    case INTERNAL.clockSchedule: {
      const commandType = payload.commandType as string;
      if (!context.catalog.command(commandType)) {
        unsupported();
        return;
      }
      const jobSequence = context.allocators.job.next();
      const jobId = formatCanonicalId(context.epoch, 'job', jobSequence);
      try {
        const job = context.clock.schedule(jobId, jobSequence, {
          type: commandType,
          payload: payload.payload as JsonValue,
          causationId: (payload.causationId as string | null) ?? null,
          issuerModuleId: operation.issuer.moduleId,
          issuerInstanceId: operation.issuer.instanceId,
        }, payload.delayMs as number);
        stateChanged(context, operation, { jobId: job.jobId, dueTime: job.dueTime, allocationSequence: job.allocationSequence });
      } catch {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_INVALID_PAYLOAD', {
          moduleId: operation.issuer.moduleId, instanceId: operation.issuer.instanceId, operationId: operation.operationId,
        })));
      }
      return;
    }
    case INTERNAL.clockCancelJob: {
      const result = context.clock.cancel(payload.jobId as string);
      if (result.cancelled) stateChanged(context, operation, result);
      else stateUnchanged(context, operation, result);
      return;
    }
    case INTERNAL.streamOpen: {
      const method = context.streamMethods.get(payload.methodId as string);
      if (!method) {
        unsupported();
        return;
      }
      const ownerInstanceId = (payload.ownerInstanceId as string | null) ?? null;
      const ownerInstance = ownerInstanceId
        ? context.committed.snapshot.instances[ownerInstanceId]
        : null;
      if (ownerInstanceId && (
        !ownerInstance
        || ownerInstance.moduleId !== method.ownerModuleId
        || !['loading', 'preparing', 'inactive', 'active'].includes(ownerInstance.status)
      )) {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError(
          ownerInstance ? 'SIMULATOR_INVALID_LIFECYCLE' : 'SIMULATOR_INSTANCE_DISPOSED',
          { moduleId: method.ownerModuleId, instanceId: ownerInstanceId, operationId: operation.operationId },
        )));
        return;
      }
      const streamSequence = context.allocators.stream.next();
      const streamId = formatCanonicalId(context.epoch, 'stream', streamSequence);
      const opened = context.streams.open({
        streamId,
        epoch: context.epoch,
        ownerModuleId: method.ownerModuleId,
        ownerInstanceId,
        sourceEventType: method.sourceEventType,
        terminalEventType: method.terminalEventType,
        itemSchema: method.itemSchema,
        terminalSchema: method.terminalSchema,
      });
      if ('error' in opened) {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_RESOURCE_EXHAUSTED', {
          moduleId: operation.issuer.moduleId, instanceId: operation.issuer.instanceId, operationId: operation.operationId,
        })));
        return;
      }
      let resolveCompletion: (terminal: import('./streams.ts').SimulatorStreamTerminal) => void = () => undefined;
      const completion = new Promise<import('./streams.ts').SimulatorStreamTerminal>((resolve) => {
        resolveCompletion = resolve;
      });
      context.streamHandles.set(streamId, { observer: null, completion, resolveCompletion });
      stateChanged(context, operation, { streamId, allocationSequence: opened.allocationSequence });
      return;
    }
    case INTERNAL.streamActivate: {
      const activated = context.streams.activate(payload.streamId as string);
      if (activated) stateChanged(context, operation, { activated: true });
      else stateUnchanged(context, operation, { activated: false });
      return;
    }
    case INTERNAL.streamCancel: {
      const reason = payload.reason as 'caller' | 'detach' | 'dispose';
      const terminal = context.streams.cancel(payload.streamId as string, reason);
      if (terminal) stateChanged(context, operation, { cancelled: true });
      else stateUnchanged(context, operation, { cancelled: false });
      return;
    }
    case INTERNAL.behaviorActivate: {
      const moduleId = payload.moduleId as string;
      const declaration = context.moduleCatalogs.get(moduleId);
      const behavior = context.moduleBehaviors.get(moduleId);
      if (!declaration || !behavior) {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_MODULE_FAILED', {
          moduleId, operationId: operation.operationId,
        })));
        return;
      }
      if (context.committed.snapshot.modules[moduleId] !== undefined) {
        stateUnchanged(context, operation, { moduleId, activated: false });
        return;
      }
      const initial = behavior.initialState({
        scenarioId: context.scenario.scenarioId,
        scenarioRevision: context.scenario.scenarioRevision,
        moduleData: declaration.moduleData,
        sharedProjection: sharedProjectionFor(context, moduleId),
      });
      let validated: JsonValue;
      try {
        validated = assertJsonValue(initial);
      } catch {
        abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { moduleId }));
        return;
      }
      context.committed = {
        ...context.committed,
        snapshot: {
          ...context.committed.snapshot,
          modules: { ...context.committed.snapshot.modules, [moduleId]: freezeJsonValue(validated) },
        },
      };
      context.loadedModules.add(moduleId);
      stateChanged(context, operation, { moduleId, activated: true });
      return;
    }
    case INTERNAL.instanceOpen: {
      const moduleId = payload.moduleId as string;
      if (!isSimulatorRouteState(payload.initialRoute as JsonValue)) {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_INVALID_PAYLOAD', {
          moduleId,
          operationId: operation.operationId,
        })));
        return;
      }
      if (!context.moduleCatalogs.has(moduleId)) {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_MODULE_FAILED', {
          moduleId, operationId: operation.operationId,
        })));
        return;
      }
      const instanceSequence = context.allocators.instance.next();
      const instanceId = formatCanonicalId(context.epoch, 'instance', instanceSequence);
      context.committed = {
        ...context.committed,
        snapshot: {
          ...context.committed.snapshot,
          instances: {
            ...context.committed.snapshot.instances,
            [instanceId]: {
              moduleId,
              surfaceId: payload.surfaceId as string,
              status: 'loading',
              creationSequence: instanceSequence,
              route: payload.initialRoute as unknown as SimulatorRouteState,
              presentation: null,
            },
          },
        },
      };
      stateChanged(context, operation, { instanceId, creationSequence: instanceSequence });
      return;
    }
    case INTERNAL.instanceTransition: {
      processInstanceTransition(context, operation, payload);
      return;
    }
    case INTERNAL.instanceDisposed: {
      const instanceId = payload.instanceId as string;
      const instance = context.committed.snapshot.instances[instanceId];
      if (!instance || instance.status !== 'disposing') {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', {
          instanceId, operationId: operation.operationId,
        })));
        return;
      }
      context.committed = {
        ...context.committed,
        snapshot: {
          ...context.committed.snapshot,
          instances: { ...context.committed.snapshot.instances, [instanceId]: { ...instance, status: 'disposed' } },
        },
      };
      stateChanged(context, operation, { instanceId, status: 'disposed' });
      return;
    }
    case INTERNAL.instanceRoute: {
      const instanceId = payload.instanceId as string;
      if (!isSimulatorRouteState(payload.route as JsonValue)) {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_INVALID_PAYLOAD', {
          instanceId,
          operationId: operation.operationId,
        })));
        return;
      }
      const instance = context.committed.snapshot.instances[instanceId];
      if (!instance || (instance.status !== 'inactive' && instance.status !== 'active')) {
        recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError(
          instance ? 'SIMULATOR_INVALID_LIFECYCLE' : 'SIMULATOR_INSTANCE_DISPOSED',
          { instanceId, operationId: operation.operationId },
        )));
        return;
      }
      context.committed = {
        ...context.committed,
        snapshot: {
          ...context.committed.snapshot,
          instances: {
            ...context.committed.snapshot.instances,
            [instanceId]: { ...instance, route: payload.route as unknown as SimulatorRouteState },
          },
        },
      };
      stateChanged(context, operation, { instanceId, route: payload.route as JsonValue });
      return;
    }
    case INTERNAL.readinessSettle: {
      const shell = context.committed.snapshot.shell as Record<string, JsonValue>;
      const readiness = { ...((shell.readiness as Record<string, JsonValue> | undefined) ?? {}) };
      readiness[payload.readinessId as string] = {
        surfaceId: payload.surfaceId,
        instanceId: payload.instanceId,
        state: payload.state,
        reason: payload.reason,
        markedAtLogicalTime: payload.markedAtLogicalTime,
      };
      context.committed = {
        ...context.committed,
        snapshot: {
          ...context.committed.snapshot,
          shell: freezeJsonValue({ ...shell, readiness }),
        },
      };
      stateChanged(context, operation, { readinessId: payload.readinessId as string, state: payload.state as string });
      return;
    }
    case INTERNAL.reset: {
      beginResetLinearization(context, operation);
      return;
    }
    default: {
      unsupported();
    }
  }
}

function processInstanceTransition(context: EngineContext, operation: QueuedOperation, payload: Record<string, JsonValue>): void {
  const instanceId = payload.instanceId as string;
  const transition = payload.transition as string;
  const instance = context.committed.snapshot.instances[instanceId];
  if (!instance) {
    recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_INSTANCE_DISPOSED', {
      instanceId, operationId: operation.operationId,
    })));
    return;
  }
  const nextStatus = INSTANCE_TRANSITIONS[`${instance.status}:${transition}`];
  if (!nextStatus) {
    recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', {
      instanceId, operationId: operation.operationId,
    })));
    return;
  }
  context.committed = {
    ...context.committed,
    snapshot: {
      ...context.committed.snapshot,
      instances: { ...context.committed.snapshot.instances, [instanceId]: { ...instance, status: nextStatus } },
    },
  };
  stateChanged(context, operation, { instanceId, status: nextStatus });
}
