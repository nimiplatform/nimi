/** Deterministic State Engine ownership for Shell overlay lifecycle records. */

import { freezeJsonValue, type JsonValue } from './json-value.ts';
import { simulatorError, simulatorFail, simulatorOk } from './errors.ts';
import { formatCanonicalId } from './ids.ts';
import type { SimulatorSchema } from './schema.ts';
import { INTERNAL, type QueuedOperation } from './engine-types.ts';
import type { EngineContext } from './engine-context.ts';
import { recordSettlement } from './engine-context.ts';
import { abortIntegrity, notifyStateSubscribers } from './module-commands.ts';

export const SIMULATOR_OVERLAY_MAX_ACTIVE_LEASES = 10000;

const INSTANCE_ID_SCHEMA: SimulatorSchema = {
  kind: 'string',
  pattern: /^[0-9]+:instance:[0-9]+$/,
  minLength: 1,
};
const OVERLAY_ID_SCHEMA: SimulatorSchema = {
  kind: 'string',
  pattern: /^[0-9]+:overlay:[0-9]+$/,
  minLength: 1,
};
const NULLABLE_SEMANTIC_ID_SCHEMA: SimulatorSchema = {
  kind: 'union',
  variants: [
    { kind: 'null' },
    { kind: 'string', minLength: 1, maxLength: 128 },
  ],
};

const OVERLAY_OPTIONS_SCHEMA: SimulatorSchema = {
  kind: 'object',
  properties: {
    kind: { kind: 'stringEnum', values: ['dialog', 'popover', 'menu', 'tooltip'] },
    modal: { kind: 'boolean' },
    dismissOnEscape: { kind: 'boolean' },
    dismissOnOutsidePointer: { kind: 'boolean' },
    returnFocus: { kind: 'boolean' },
    initialFocusSemanticId: NULLABLE_SEMANTIC_ID_SCHEMA,
    returnFocusSemanticId: NULLABLE_SEMANTIC_ID_SCHEMA,
    scrollLock: { kind: 'stringEnum', values: ['none', 'simulator-root'] },
    ariaLabel: { kind: 'string', minLength: 1, maxLength: 256 },
  },
};

interface OverlayRecord {
  readonly ownerInstanceId: string;
  readonly state: 'open' | 'dismiss-requested' | 'releasing' | 'released';
  readonly options: JsonValue;
  readonly dismissReason: string | null;
}

export function registerOverlayCommands(context: EngineContext): void {
  const shellOwner = { kind: 'shell' } as const;
  context.catalog.registerCommand({
    kind: 'command',
    type: INTERNAL.overlayAcquire,
    owner: shellOwner,
    payloadSchema: {
      kind: 'object',
      properties: {
        ownerInstanceId: INSTANCE_ID_SCHEMA,
        options: OVERLAY_OPTIONS_SCHEMA,
      },
    },
    writeSet: ['shell'],
    requiredCapabilities: [],
  });
  context.catalog.registerCommand({
    kind: 'command',
    type: INTERNAL.overlayDismiss,
    owner: shellOwner,
    payloadSchema: {
      kind: 'object',
      properties: {
        overlayId: OVERLAY_ID_SCHEMA,
        reason: { kind: 'stringEnum', values: ['escape', 'outside-pointer', 'app', 'dispose'] },
      },
    },
    writeSet: ['shell'],
    requiredCapabilities: [],
  });
  context.catalog.registerCommand({
    kind: 'command',
    type: INTERNAL.overlayBeginRelease,
    owner: shellOwner,
    payloadSchema: {
      kind: 'object',
      properties: { overlayId: OVERLAY_ID_SCHEMA },
    },
    writeSet: ['shell'],
    requiredCapabilities: [],
  });
  context.catalog.registerCommand({
    kind: 'command',
    type: INTERNAL.overlayReleased,
    owner: shellOwner,
    payloadSchema: {
      kind: 'object',
      properties: { overlayId: OVERLAY_ID_SCHEMA },
    },
    writeSet: ['shell'],
    requiredCapabilities: [],
  });
}

export function processOverlayCommand(
  context: EngineContext,
  operation: QueuedOperation,
): boolean {
  if (operation.type === INTERNAL.overlayAcquire) {
    acquireOverlay(context, operation);
    return true;
  }
  if (operation.type === INTERNAL.overlayDismiss) {
    transitionOverlay(context, operation, 'open', 'dismiss-requested');
    return true;
  }
  if (operation.type === INTERNAL.overlayBeginRelease) {
    transitionOverlay(context, operation, 'dismiss-requested', 'releasing');
    return true;
  }
  if (operation.type === INTERNAL.overlayReleased) {
    transitionOverlay(context, operation, 'releasing', 'released');
    return true;
  }
  return false;
}

function acquireOverlay(context: EngineContext, operation: QueuedOperation): void {
  const payload = operation.payload as Record<string, JsonValue>;
  const ownerInstanceId = payload.ownerInstanceId as string;
  const instance = context.committed.snapshot.instances[ownerInstanceId];
  if (!instance || !['preparing', 'inactive', 'active'].includes(instance.status)) {
    recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError(
      instance ? 'SIMULATOR_INVALID_LIFECYCLE' : 'SIMULATOR_INSTANCE_DISPOSED',
      { instanceId: ownerInstanceId, operationId: operation.operationId },
    )));
    return;
  }
  const overlays = readOverlayRecords(context);
  const activeCount = Object.values(overlays)
    .filter((record) => record.state !== 'released').length;
  if (activeCount >= SIMULATOR_OVERLAY_MAX_ACTIVE_LEASES) {
    recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError(
      'SIMULATOR_RESOURCE_EXHAUSTED',
      { instanceId: ownerInstanceId, operationId: operation.operationId },
    )));
    return;
  }

  let allocationSequence: number;
  try {
    allocationSequence = context.allocators.overlay.next();
  } catch {
    recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError(
      'SIMULATOR_RESOURCE_EXHAUSTED',
      { instanceId: ownerInstanceId, operationId: operation.operationId },
    )));
    return;
  }
  const overlayId = formatCanonicalId(context.epoch, 'overlay', allocationSequence);
  commitOverlayRecords(context, {
    ...overlays,
    [overlayId]: {
      ownerInstanceId,
      state: 'open',
      options: payload.options as JsonValue,
      dismissReason: null,
    },
  });
  overlayStateChanged(context, operation, { overlayId, allocationSequence });
}

function transitionOverlay(
  context: EngineContext,
  operation: QueuedOperation,
  expected: OverlayRecord['state'],
  next: OverlayRecord['state'],
): void {
  const payload = operation.payload as Record<string, JsonValue>;
  const overlayId = payload.overlayId as string;
  const overlays = readOverlayRecords(context);
  const record = overlays[overlayId];
  if (!record) {
    recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError(
      'SIMULATOR_INSTANCE_DISPOSED',
      { instanceId: operation.issuer.instanceId, operationId: operation.operationId },
    )));
    return;
  }
  if (record.state !== expected) {
    overlayStateUnchanged(context, operation, {
      changed: false,
      state: record.state,
    });
    return;
  }
  const nextRecord: OverlayRecord = {
    ...record,
    state: next,
    dismissReason: next === 'dismiss-requested'
      ? payload.reason as string
      : record.dismissReason,
  };
  if (next === 'released') {
    const remaining = { ...overlays };
    delete remaining[overlayId];
    commitOverlayRecords(context, remaining);
  } else {
    commitOverlayRecords(context, { ...overlays, [overlayId]: nextRecord });
  }
  overlayStateChanged(context, operation, { changed: true, state: next });
}

function readOverlayRecords(context: EngineContext): Record<string, OverlayRecord> {
  const shell = context.committed.snapshot.shell;
  if (!shell || typeof shell !== 'object' || Array.isArray(shell)) {
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
  const overlays = (shell as Record<string, JsonValue>).overlays;
  if (overlays === undefined) return {};
  if (!overlays || typeof overlays !== 'object' || Array.isArray(overlays)) {
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
  return overlays as unknown as Record<string, OverlayRecord>;
}

function commitOverlayRecords(
  context: EngineContext,
  overlays: Record<string, OverlayRecord>,
): void {
  const shell = context.committed.snapshot.shell as Record<string, JsonValue>;
  context.committed = {
    ...context.committed,
    snapshot: {
      ...context.committed.snapshot,
      shell: freezeJsonValue({ ...shell, overlays: overlays as unknown as JsonValue }),
    },
  };
}

function overlayStateChanged(
  context: EngineContext,
  operation: QueuedOperation,
  value: JsonValue,
): void {
  context.committed = { ...context.committed, revision: context.committed.revision + 1 };
  notifyStateSubscribers(context);
  recordSettlement(context, operation.sequence, operation.settle, simulatorOk(value));
}

function overlayStateUnchanged(
  context: EngineContext,
  operation: QueuedOperation,
  value: JsonValue,
): void {
  recordSettlement(context, operation.sequence, operation.settle, simulatorOk(value));
}
