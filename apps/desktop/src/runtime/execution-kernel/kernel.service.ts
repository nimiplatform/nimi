import { RuntimeControlPlaneClient } from '../control-plane/client';
import { executeLocalKernelTurn } from '../llm-adapter/execution/kernel-turn';
import type { ExecuteLocalKernelTurnResult } from '../llm-adapter/execution/types';
import { DesktopHookRuntimeService } from '../hook';
import { LocalAuditLedger } from './audit/local-audit-ledger';
import type {
  DecisionRecord,
  DiscoverInput,
  ExecuteLocalTurnInput,
  InstallInput,
  LifecycleInput,
  LifecycleState,
  UpdateInput,
} from './contracts/types';
import { DependencyResolver } from './dependency/dependency-resolver';
import { RegistryGateway } from './discovery/registry-gateway';
import { LifecycleManager } from './lifecycle/lifecycle-manager';
import { ModuleLoader } from './loader/module-loader';
import { ManifestEngine } from './manifest/manifest-engine';
import { PolicyEngine } from './policy/policy-engine';
import { SandboxManager } from './sandbox/sandbox-manager';
import { AuthVerifier } from './signature/auth-verifier';
import { CrashIsolator } from './crash-isolator/crash-isolator';
import { runInstallFlow } from './kernel/flows/install-flow';
import {
  runDisableFlow,
  runEnableFlow,
  runUninstallFlow,
  runUpdateFlow,
} from './kernel/flows/lifecycle-flow';
import { runLocalTurnFlow } from './kernel/flows/local-turn-flow';
import {
  buildContextKey,
  buildDecisionRecord,
  collectInstalledMods,
  persistStageTrailRecords,
  resolveSandboxCapability,
  type RuntimeContext,
} from './kernel/kernel-service-utils';

export class DesktopExecutionKernelService {
  private readonly controlPlane = new RuntimeControlPlaneClient();
  private readonly registry = new RegistryGateway();
  private readonly manifest = new ManifestEngine();
  private readonly signature = new AuthVerifier(this.controlPlane);
  private readonly dependency = new DependencyResolver();
  private readonly policy = new PolicyEngine(this.controlPlane);
  private readonly sandbox = new SandboxManager();
  private readonly loader = new ModuleLoader();
  private readonly lifecycle = new LifecycleManager();
  private readonly crashIsolator = new CrashIsolator();
  private readonly audit = new LocalAuditLedger();
  private readonly contexts = new Map<string, RuntimeContext>();
  private readonly hookRuntime: DesktopHookRuntimeService;

  constructor(hookRuntime?: DesktopHookRuntimeService) {
    this.hookRuntime = hookRuntime || new DesktopHookRuntimeService();
  }

  getHookRuntime(): DesktopHookRuntimeService {
    return this.hookRuntime;
  }

  async discover(input: DiscoverInput): Promise<{ modId: string; version: string; stageTrail: DecisionRecord[] }> {
    const records: DecisionRecord[] = [];
    const source = this.registry.verifySource(input.mode, input.source?.ref);
    records.push(buildDecisionRecord(input.modId, input.version, 'discovery', source.ok ? 'ALLOW' : 'DENY', [source.reasonCode]));

    if (source.ok) {
      this.registry.recordDiscovery(
        input.modId,
        input.version,
        input.source?.ref || '',
        input.mode,
      );
    }

    const manifest = this.manifest.buildDefault(input.modId, input.version);
    const issues = this.manifest.validate(manifest);
    records.push(buildDecisionRecord(
      input.modId,
      input.version,
      'manifest/compat',
      issues.length > 0 ? 'DENY' : 'ALLOW',
      issues.length > 0 ? issues : ['MANIFEST_VALID'],
    ));

    await persistStageTrailRecords(this.audit, records, 'KERNEL_DISCOVER');

    return {
      modId: input.modId,
      version: input.version,
      stageTrail: records,
    };
  }

  async install(input: InstallInput): Promise<{ state: LifecycleState; stageTrail: DecisionRecord[] }> {
    return runInstallFlow({
      input,
      verifySource: (mode, ref) => this.registry.verifySource(mode, ref),
      recordDiscovery: (modId, version, ref, mode) => this.registry.recordDiscovery(modId, version, ref, mode),
      buildManifest: (modId, version, requestedCapabilities) => this.manifest.buildDefault(modId, version, requestedCapabilities),
      validateManifest: (manifest) => this.manifest.validate(manifest),
      verifySignature: (signatureInput) => this.signature.verify(signatureInput),
      resolveDependency: (manifest) => this.dependency.resolve(manifest),
      evaluatePolicy: (policyInput) => this.policy.evaluate(policyInput),
      createSandbox: (sandboxInput) => this.sandbox.create(sandboxInput),
      loadModule: (loadInput) => this.loader.load(loadInput),
      setLifecycle: (modId, version, state) => this.lifecycle.set(modId, version, state),
      registerInstalled: (modId, version, dependencies) => this.dependency.registerInstalled(modId, version, dependencies),
      setContext: (runtimeKey, context) => this.contexts.set(runtimeKey, context),
      setCapabilityBaseline: (modId, capabilities) => this.hookRuntime.setCapabilityBaseline(modId, capabilities),
      makeDecision: buildDecisionRecord,
      keyFor: buildContextKey,
      persistStageTrail: (stageTrail, eventType) => persistStageTrailRecords(this.audit, stageTrail, eventType),
    });
  }

  async enable(input: LifecycleInput): Promise<{ state: LifecycleState }> {
    return runEnableFlow({
      lifecycle: input,
      getContext: (runtimeKey) => this.contexts.get(runtimeKey),
      setContextState: (runtimeKey, state) => {
        const ctx = this.contexts.get(runtimeKey);
        if (ctx) ctx.state = state;
      },
      setLifecycle: (modId, version, state) => this.lifecycle.set(modId, version, state),
      setCapabilityBaseline: (modId, capabilities) => this.hookRuntime.setCapabilityBaseline(modId, capabilities),
      appendAudit: (entry) => this.audit.append(entry),
      keyFor: buildContextKey,
    });
  }

  async disable(input: LifecycleInput): Promise<{ state: LifecycleState }> {
    return runDisableFlow({
      lifecycle: input,
      getContext: (runtimeKey) => this.contexts.get(runtimeKey),
      setContextState: (runtimeKey, state) => {
        const ctx = this.contexts.get(runtimeKey);
        if (ctx) ctx.state = state;
      },
      setLifecycle: (modId, version, state) => this.lifecycle.set(modId, version, state),
      suspendMod: (modId) => this.hookRuntime.suspendMod(modId),
      appendAudit: (entry) => this.audit.append(entry),
      keyFor: buildContextKey,
    });
  }

  async uninstall(input: LifecycleInput): Promise<{ state: LifecycleState }> {
    return runUninstallFlow({
      lifecycle: input,
      getContext: (runtimeKey) => this.contexts.get(runtimeKey),
      deleteContext: (runtimeKey) => { this.contexts.delete(runtimeKey); },
      destroySandboxByMod: (modId, version) => this.sandbox.destroyByMod(modId, version),
      unloadModule: (modId, version) => this.loader.unload(modId, version),
      unregisterInstalled: (modId) => this.dependency.unregisterInstalled(modId),
      setLifecycle: (modId, version, state) => this.lifecycle.set(modId, version, state),
      suspendMod: (modId) => this.hookRuntime.suspendMod(modId),
      resetCrash: (modId) => this.crashIsolator.reset(modId),
      appendAudit: (entry) => this.audit.append(entry),
      keyFor: buildContextKey,
    });
  }

  async update(input: UpdateInput): Promise<{ state: LifecycleState; targetVersion: string }> {
    return runUpdateFlow({
      update: input,
      disable: (lifecycle) => this.disable(lifecycle),
      install: (installInput) => this.install(installInput),
      enable: (lifecycle) => this.enable(lifecycle),
      getLifecycle: (modId, version) => this.lifecycle.get(modId, version),
      deleteContext: (runtimeKey) => { this.contexts.delete(runtimeKey); },
      setLifecycle: (modId, version, state) => this.lifecycle.set(modId, version, state),
      keyFor: buildContextKey,
    });
  }

  async executeLocalTurn(input: ExecuteLocalTurnInput): Promise<ExecuteLocalKernelTurnResult> {
    return runLocalTurnFlow({
      input,
      invokeTurnHooks: (turnInput) => this.hookRuntime.invokeTurnHooks(turnInput),
      executeLocalKernelTurn: (runtimeInput) => executeLocalKernelTurn(runtimeInput),
      appendAudit: (entry) => this.audit.append(entry),
      reportCrash: (crashKey) => this.crashIsolator.report(crashKey),
      shouldDisable: (crashKey) => this.crashIsolator.shouldDisable(crashKey),
    });
  }

  async getAudit(filter?: { modId?: string; stage?: string; from?: string; to?: string; limit?: number }) { return this.audit.query(filter); }

  getModContext(modId: string, version: string): RuntimeContext | undefined {
    return this.contexts.get(buildContextKey(modId, version));
  }

  getModState(modId: string, version: string): LifecycleState | undefined {
    return this.lifecycle.get(modId, version);
  }

  listInstalledMods(): Array<{ modId: string; version: string; state: LifecycleState; mode: InstallInput['mode'] }> { return collectInstalledMods(this.contexts); }

  getCrashStatus(modId: string): { crashCount: number; disabled: boolean; lastCrashAt: string | null } { return this.crashIsolator.getStatus(modId); }

  checkSandboxCapability(modId: string, version: string, capability: string): { allowed: boolean; reasonCode: string } {
    return resolveSandboxCapability(this.contexts, this.sandbox, buildContextKey(modId, version), capability);
  }
}
