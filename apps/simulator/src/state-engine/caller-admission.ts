/** Closed caller/target admission for State Engine operations. */

import type { SimulatorOperationOwner } from './catalog.ts';
import type { EngineContext } from './engine-context.ts';
import { simulatorError, type SimulatorError } from './errors.ts';
import { INTERNAL, QUERY_COMMITTED } from './engine-types.ts';
import type { JsonValue } from './json-value.ts';
import type { SimulatorIssuer } from './types.ts';
import { SIMULATOR_INTERACTION_EMIT } from './interactions.ts';

const LIVE_INSTANCE_STATUSES = new Set(['loading', 'preparing', 'inactive', 'active']);

function instanceEpoch(instanceId: string): number | null {
  const matched = /^(\d+):instance:\d+$/u.exec(instanceId);
  if (!matched) return null;
  const epoch = Number(matched[1]);
  return Number.isSafeInteger(epoch) && epoch > 0 ? epoch : null;
}

export function validateLiveIssuer(
  context: EngineContext,
  issuer: SimulatorIssuer,
): SimulatorError | null {
  if (issuer.kind === 'shell' || issuer.kind === 'scenario') {
    return issuer.moduleId === null && issuer.instanceId === null
      ? null
      : simulatorError('SIMULATOR_CAPABILITY_DENIED', {
          moduleId: issuer.moduleId,
          instanceId: issuer.instanceId,
        });
  }
  if (!issuer.moduleId || !issuer.instanceId) {
    return simulatorError('SIMULATOR_CAPABILITY_DENIED', {
      moduleId: issuer.moduleId,
      instanceId: issuer.instanceId,
    });
  }
  const epoch = instanceEpoch(issuer.instanceId);
  if (epoch !== null && epoch !== context.epoch) {
    return simulatorError('SIMULATOR_STALE_EPOCH', {
      moduleId: issuer.moduleId,
      instanceId: issuer.instanceId,
    });
  }
  const instance = context.committed.snapshot.instances[issuer.instanceId];
  if (!instance || !LIVE_INSTANCE_STATUSES.has(instance.status)) {
    return simulatorError('SIMULATOR_INSTANCE_DISPOSED', {
      moduleId: issuer.moduleId,
      instanceId: issuer.instanceId,
    });
  }
  return instance.moduleId === issuer.moduleId
    ? null
    : simulatorError('SIMULATOR_CAPABILITY_DENIED', {
        moduleId: issuer.moduleId,
        instanceId: issuer.instanceId,
      });
}

export function admitsReservationCaller(
  owner: SimulatorOperationOwner,
  issuer: SimulatorIssuer,
): boolean {
  if (owner.kind === 'scenario') return false;
  if (owner.kind === 'shell') return issuer.kind === 'shell';
  return issuer.kind !== 'instance' || owner.moduleId === issuer.moduleId;
}

function instanceOwnsOverlay(context: EngineContext, instanceId: string, overlayId: string): boolean {
  const shell = context.committed.snapshot.shell;
  if (!shell || typeof shell !== 'object' || Array.isArray(shell)) return false;
  const overlays = (shell as Record<string, JsonValue>).overlays;
  if (!overlays || typeof overlays !== 'object' || Array.isArray(overlays)) return false;
  const overlay = (overlays as Record<string, JsonValue>)[overlayId];
  return Boolean(
    overlay
    && typeof overlay === 'object'
    && !Array.isArray(overlay)
    && (overlay as Record<string, JsonValue>).ownerInstanceId === instanceId,
  );
}

function admitsInstanceShellOperation(
  context: EngineContext,
  type: string,
  payload: JsonValue,
  issuer: SimulatorIssuer,
): boolean {
  const input = payload as Record<string, JsonValue>;
  switch (type) {
    case SIMULATOR_INTERACTION_EMIT: {
      const source = input.source;
      return Boolean(
        source
        && typeof source === 'object'
        && !Array.isArray(source)
        && (source as Record<string, JsonValue>).moduleId === issuer.moduleId
        && (source as Record<string, JsonValue>).instanceId === issuer.instanceId,
      );
    }
    case INTERNAL.instanceRoute:
      return input.instanceId === issuer.instanceId;
    case INTERNAL.clockSchedule: {
      const target = context.catalog.command(input.commandType as string);
      return target?.owner.kind === 'module' && target.owner.moduleId === issuer.moduleId;
    }
    case INTERNAL.clockCancelJob: {
      const job = context.clock.pendingJobs().find((entry) => entry.jobId === input.jobId);
      return !job || (
        job.command.issuerInstanceId === issuer.instanceId
        && job.command.issuerModuleId === issuer.moduleId
      );
    }
    case INTERNAL.streamOpen: {
      const method = context.streamMethods.get(input.methodId as string);
      return Boolean(
        method
        && method.ownerModuleId === issuer.moduleId
        && input.ownerInstanceId === issuer.instanceId,
      );
    }
    case INTERNAL.streamActivate:
    case INTERNAL.streamCancel: {
      const stream = context.streams.get(input.streamId as string);
      return Boolean(
        stream
        && stream.ownerInstanceId === issuer.instanceId
        && stream.ownerModuleId === issuer.moduleId,
      );
    }
    case INTERNAL.overlayAcquire:
      return input.ownerInstanceId === issuer.instanceId;
    case INTERNAL.overlayDismiss:
    case INTERNAL.overlayBeginRelease:
    case INTERNAL.overlayReleased:
      return issuer.instanceId !== null
        && instanceOwnsOverlay(context, issuer.instanceId, input.overlayId as string);
    default:
      return false;
  }
}

export function admitOperationCaller(
  context: EngineContext,
  input: {
    readonly kind: 'command' | 'query';
    readonly type: string;
    readonly payload: JsonValue;
    readonly issuer: SimulatorIssuer;
    readonly owner: SimulatorOperationOwner;
  },
): SimulatorError | null {
  const issuerError = validateLiveIssuer(context, input.issuer);
  if (issuerError) return issuerError;

  if (input.owner.kind === 'scenario') {
    return input.issuer.kind === 'scenario'
      ? null
      : simulatorError('SIMULATOR_CAPABILITY_DENIED', {
          moduleId: input.issuer.moduleId,
          instanceId: input.issuer.instanceId,
        });
  }
  if (input.owner.kind === 'module') {
    return input.issuer.kind !== 'instance' || input.issuer.moduleId === input.owner.moduleId
      ? null
      : simulatorError('SIMULATOR_CAPABILITY_DENIED', {
          moduleId: input.issuer.moduleId,
          instanceId: input.issuer.instanceId,
        });
  }
  if (input.issuer.kind === 'shell') return null;
  if (
    input.issuer.kind === 'instance'
    && input.kind === 'command'
    && admitsInstanceShellOperation(context, input.type, input.payload, input.issuer)
  ) {
    return null;
  }
  return simulatorError('SIMULATOR_CAPABILITY_DENIED', {
    moduleId: input.issuer.moduleId,
    instanceId: input.issuer.instanceId,
  });
}

export function isOwnDeclaredEvent(
  context: EngineContext,
  moduleId: string,
  fullEventType: string,
): boolean {
  const prefix = `${moduleId}.`;
  if (!fullEventType.startsWith(prefix)) return false;
  return fullEventType.length > prefix.length
    && Object.hasOwn(context.moduleCatalogs.get(moduleId)?.eventSchemas ?? {}, fullEventType);
}

export function adapterCommandAdmissionError(
  type: string,
  moduleId: string,
  instanceId: string,
  staleError: SimulatorError | null,
): SimulatorError | null {
  if (staleError) return staleError;
  return type !== QUERY_COMMITTED && !type.startsWith('simulator.')
    ? null
    : simulatorError('SIMULATOR_CAPABILITY_DENIED', { moduleId, instanceId });
}
