import { emitRuntimeLog } from '../../../telemetry/logger';
import { extractRuntimeErrorFields } from '../../../telemetry/error-fields';
import type {
  InstallInput,
  KernelStage,
  LifecycleInput,
  LifecycleState,
  ModManifest,
  UpdateInput,
} from '../../contracts/types';
import { ReasonCode } from '@nimiplatform/sdk/types';

type RuntimeContext = {
  manifest: ModManifest;
  grantedCapabilities: string[];
  sandboxProfileId: string;
  instanceId: string;
  state: LifecycleState;
  mode: InstallInput['mode'];
};

type LifecycleAuditInput = {
  appendAudit: (entry: {
    id: string;
    modId: string;
    stage: KernelStage;
    eventType: string;
    decision: 'ALLOW' | 'DENY' | 'ALLOW_WITH_WARNING';
    reasonCodes: string[];
    occurredAt: string;
  }) => Promise<void>;
  modId: string;
  version: string;
  eventType: 'MOD_ENABLED' | 'MOD_DISABLED' | 'MOD_UNINSTALLED';
  reasonCode:
    | typeof ReasonCode.STATE_ENABLED
    | typeof ReasonCode.STATE_DISABLED
    | typeof ReasonCode.STATE_UNINSTALLED;
};

async function appendLifecycleAudit(input: LifecycleAuditInput) {
  try {
    await input.appendAudit({
      id: `audit:lifecycle:${Date.now().toString(36)}`,
      modId: input.modId,
      stage: 'lifecycle',
      eventType: input.eventType,
      decision: 'ALLOW',
      reasonCodes: [input.reasonCode],
      occurredAt: new Date().toISOString(),
    });
  } catch (error) {
    const errorFields = extractRuntimeErrorFields(error);
    emitRuntimeLog({
      level: 'error',
      area: 'execution-kernel',
      message: 'action:audit-persistence:failed',
      traceId: errorFields.traceId,
      details: {
        modId: input.modId,
        version: input.version,
        eventType: input.eventType,
        reasonCode: errorFields.reasonCode,
        actionHint: errorFields.actionHint,
        retryable: errorFields.retryable,
        traceId: errorFields.traceId,
        error: errorFields.message || (error instanceof Error ? error.message : String(error || '')),
      },
    });
  }
}

export async function runEnableFlow(input: {
  lifecycle: LifecycleInput;
  getContext: (key: string) => RuntimeContext | undefined;
  setContextState: (key: string, state: LifecycleState) => void;
  setLifecycle: (modId: string, version: string, state: LifecycleState) => void;
  setCapabilityBaseline: (modId: string, capabilities: string[]) => void;
  appendAudit: LifecycleAuditInput['appendAudit'];
  keyFor: (modId: string, version: string) => string;
}) {
  const ctx = input.getContext(input.keyFor(input.lifecycle.modId, input.lifecycle.version));
  if (!ctx) {
    throw new Error(`LIFECYCLE_TRANSITION_INVALID: ${input.lifecycle.modId}@${input.lifecycle.version} not installed`);
  }

  input.setContextState(input.keyFor(input.lifecycle.modId, input.lifecycle.version), 'ENABLED');
  input.setLifecycle(input.lifecycle.modId, input.lifecycle.version, 'ENABLED');
  input.setCapabilityBaseline(input.lifecycle.modId, ctx.grantedCapabilities);
  await appendLifecycleAudit({
    appendAudit: input.appendAudit,
    modId: input.lifecycle.modId,
    version: input.lifecycle.version,
    eventType: 'MOD_ENABLED',
    reasonCode: ReasonCode.STATE_ENABLED,
  });
  return { state: 'ENABLED' as const };
}

export async function runDisableFlow(input: {
  lifecycle: LifecycleInput;
  getContext: (key: string) => RuntimeContext | undefined;
  setContextState: (key: string, state: LifecycleState) => void;
  setLifecycle: (modId: string, version: string, state: LifecycleState) => void;
  suspendMod: (modId: string) => void;
  appendAudit: LifecycleAuditInput['appendAudit'];
  keyFor: (modId: string, version: string) => string;
}) {
  const ctx = input.getContext(input.keyFor(input.lifecycle.modId, input.lifecycle.version));
  if (!ctx) {
    throw new Error(`LIFECYCLE_TRANSITION_INVALID: ${input.lifecycle.modId}@${input.lifecycle.version} not installed`);
  }

  input.setContextState(input.keyFor(input.lifecycle.modId, input.lifecycle.version), 'DISABLED');
  input.setLifecycle(input.lifecycle.modId, input.lifecycle.version, 'DISABLED');
  input.suspendMod(input.lifecycle.modId);
  await appendLifecycleAudit({
    appendAudit: input.appendAudit,
    modId: input.lifecycle.modId,
    version: input.lifecycle.version,
    eventType: 'MOD_DISABLED',
    reasonCode: ReasonCode.STATE_DISABLED,
  });
  return { state: 'DISABLED' as const };
}

export async function runUninstallFlow(input: {
  lifecycle: LifecycleInput;
  getContext: (key: string) => RuntimeContext | undefined;
  deleteContext: (key: string) => void;
  destroySandboxByMod: (modId: string, version: string) => void;
  unloadModule: (modId: string, version: string) => void;
  unregisterInstalled: (modId: string) => void;
  setLifecycle: (modId: string, version: string, state: LifecycleState) => void;
  suspendMod: (modId: string) => void;
  resetCrash: (modId: string) => void;
  appendAudit: LifecycleAuditInput['appendAudit'];
  keyFor: (modId: string, version: string) => string;
}) {
  const key = input.keyFor(input.lifecycle.modId, input.lifecycle.version);
  const ctx = input.getContext(key);
  if (ctx) {
    input.destroySandboxByMod(input.lifecycle.modId, input.lifecycle.version);
    input.unloadModule(input.lifecycle.modId, input.lifecycle.version);
  }
  input.deleteContext(key);
  input.unregisterInstalled(input.lifecycle.modId);
  input.setLifecycle(input.lifecycle.modId, input.lifecycle.version, 'UNINSTALLED');
  input.suspendMod(input.lifecycle.modId);
  input.resetCrash(input.lifecycle.modId);

  await appendLifecycleAudit({
    appendAudit: input.appendAudit,
    modId: input.lifecycle.modId,
    version: input.lifecycle.version,
    eventType: 'MOD_UNINSTALLED',
    reasonCode: ReasonCode.STATE_UNINSTALLED,
  });
  return { state: 'UNINSTALLED' as const };
}

export async function runUpdateFlow(input: {
  update: UpdateInput;
  disable: (lifecycle: LifecycleInput) => Promise<{ state: LifecycleState }>;
  install: (install: InstallInput) => Promise<{ state: LifecycleState }>;
  enable: (lifecycle: LifecycleInput) => Promise<{ state: LifecycleState }>;
  deleteContext: (key: string) => void;
  setLifecycle: (modId: string, version: string, state: LifecycleState) => void;
  keyFor: (modId: string, version: string) => string;
}) {
  await input.disable({
    modId: input.update.modId,
    version: input.update.version,
    actor: input.update.actor,
  });

  try {
    const installResult = await input.install({
      ...input.update,
      version: input.update.targetVersion,
    });

    if (installResult.state !== 'INSTALLED') {
      await input.enable({
        modId: input.update.modId,
        version: input.update.version,
        actor: input.update.actor,
      });
      throw new Error(
        `UPDATE_INSTALL_FAILED: ${input.update.modId}@${input.update.targetVersion} install did not reach INSTALLED (got ${installResult.state}). Rolled back to ${input.update.version}.`,
      );
    }

    await input.enable({
      modId: input.update.modId,
      version: input.update.targetVersion,
      actor: input.update.actor,
    });

    input.deleteContext(input.keyFor(input.update.modId, input.update.version));
    input.setLifecycle(input.update.modId, input.update.version, 'UNINSTALLED');

    return {
      state: 'ENABLED' as const,
      targetVersion: input.update.targetVersion,
    };
  } catch (error) {
    try {
      await input.enable({
        modId: input.update.modId,
        version: input.update.version,
        actor: input.update.actor,
      });
    } catch {
      // Best-effort rollback; original error takes precedence
    }
    throw error;
  }
}
