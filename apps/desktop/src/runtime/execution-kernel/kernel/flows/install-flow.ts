import type { DecisionRecord, InstallInput, LifecycleState, ModManifest } from '../../contracts/types';
import type { RuntimeContext } from '../kernel-service-utils';

type InstallFlowInput = {
  input: InstallInput;
  verifySource: (mode: InstallInput['mode'], ref?: string) => { ok: boolean; reasonCode: string };
  recordDiscovery: (modId: string, version: string, ref: string, mode: InstallInput['mode']) => void;
  buildManifest: (modId: string, version: string, requestedCapabilities?: string[]) => ModManifest;
  validateManifest: (manifest: ModManifest) => string[];
  verifySignature: (input: {
    modId: string;
    version: string;
    mode: InstallInput['mode'];
    signerId?: string;
    signature?: string;
    digest?: string;
  }) => Promise<{ ok: boolean; reasonCodes: string[] }>;
  resolveDependency: (manifest: ModManifest) => { ok: boolean; reasonCodes: string[] };
  evaluatePolicy: (input: {
    modId: string;
    mode: InstallInput['mode'];
    sourceType?: InstallInput['sourceType'];
    requestedCapabilities: string[];
    grantRef?: InstallInput['grantRef'];
  }) => Promise<{ ok: boolean; reasonCodes: string[]; grantedCapabilities: string[] }>;
  createSandbox: (input: { modId: string; version: string; capabilities: string[] }) => string;
  loadModule: (input: {
    modId: string;
    version: string;
    sandboxProfileId: string;
    grantedCapabilities: string[];
  }) => { ok: boolean; instanceId: string };
  setLifecycle: (modId: string, version: string, state: LifecycleState) => void;
  registerInstalled: (modId: string, version: string, dependencies: string[]) => void;
  setContext: (key: string, context: RuntimeContext) => void;
  setCapabilityBaseline: (modId: string, capabilities: string[]) => void;
  makeDecision: (
    modId: string,
    version: string,
    stage: DecisionRecord['stage'],
    result: DecisionRecord['result'],
    reasonCodes: string[],
  ) => DecisionRecord;
  keyFor: (modId: string, version: string) => string;
  persistStageTrail: (stageTrail: DecisionRecord[], eventType: string) => Promise<void>;
};

export async function runInstallFlow({
  input,
  verifySource,
  recordDiscovery,
  buildManifest,
  validateManifest,
  verifySignature,
  resolveDependency,
  evaluatePolicy,
  createSandbox,
  loadModule,
  setLifecycle,
  registerInstalled,
  setContext,
  setCapabilityBaseline,
  makeDecision,
  keyFor,
  persistStageTrail,
}: InstallFlowInput): Promise<{ state: LifecycleState; stageTrail: DecisionRecord[] }> {
  const stageTrail: DecisionRecord[] = [];

  const source = verifySource(input.mode, input.source?.ref);
  stageTrail.push(makeDecision(input.modId, input.version, 'discovery', source.ok ? 'ALLOW' : 'DENY', [source.reasonCode]));
  if (!source.ok) {
    await persistStageTrail(stageTrail, 'KERNEL_INSTALL');
    return { state: 'DISCOVERED', stageTrail };
  }
  recordDiscovery(input.modId, input.version, input.source?.ref || '', input.mode);

  const manifest = buildManifest(input.modId, input.version, input.requestedCapabilities);
  const manifestIssues = validateManifest(manifest);
  stageTrail.push(makeDecision(
    input.modId,
    input.version,
    'manifest/compat',
    manifestIssues.length > 0 ? 'DENY' : 'ALLOW',
    manifestIssues.length > 0 ? manifestIssues : ['MANIFEST_VALID'],
  ));
  if (manifestIssues.length > 0) {
    await persistStageTrail(stageTrail, 'KERNEL_INSTALL');
    return { state: 'DISCOVERED', stageTrail };
  }

  const signature = await verifySignature({
    modId: input.modId,
    version: input.version,
    mode: input.mode,
    signerId: input.signerId,
    signature: input.signature,
    digest: input.digest,
  });
  stageTrail.push(makeDecision(
    input.modId,
    input.version,
    'signature/auth',
    signature.ok
      ? (signature.reasonCodes.includes('SIGNATURE_MISSING_ALLOW_WITH_WARNING') ? 'ALLOW_WITH_WARNING' : 'ALLOW')
      : 'DENY',
    signature.reasonCodes,
  ));
  if (!signature.ok) {
    await persistStageTrail(stageTrail, 'KERNEL_INSTALL');
    return { state: 'DISCOVERED', stageTrail };
  }

  const dep = resolveDependency(manifest);
  stageTrail.push(makeDecision(input.modId, input.version, 'dependency/build', dep.ok ? 'ALLOW' : 'DENY', dep.reasonCodes));
  if (!dep.ok) {
    await persistStageTrail(stageTrail, 'KERNEL_INSTALL');
    return { state: 'DISCOVERED', stageTrail };
  }

  const policy = await evaluatePolicy({
    modId: input.modId,
    mode: input.mode,
    sourceType: input.sourceType,
    requestedCapabilities: input.requestedCapabilities || manifest.capabilities,
    grantRef: input.grantRef,
  });
  stageTrail.push(makeDecision(input.modId, input.version, 'sandbox/policy', policy.ok ? 'ALLOW' : 'DENY', policy.reasonCodes));
  if (!policy.ok) {
    await persistStageTrail(stageTrail, 'KERNEL_INSTALL');
    return { state: 'DISCOVERED', stageTrail };
  }

  const sandboxProfileId = createSandbox({
    modId: input.modId,
    version: input.version,
    capabilities: policy.grantedCapabilities,
  });
  const loaded = loadModule({
    modId: input.modId,
    version: input.version,
    sandboxProfileId,
    grantedCapabilities: policy.grantedCapabilities,
  });
  stageTrail.push(makeDecision(input.modId, input.version, 'load', loaded.ok ? 'ALLOW' : 'DENY', loaded.ok ? ['LOAD_OK'] : ['LOAD_FAILED']));
  if (!loaded.ok) {
    await persistStageTrail(stageTrail, 'KERNEL_INSTALL');
    return { state: 'DISCOVERED', stageTrail };
  }

  setLifecycle(input.modId, input.version, 'INSTALLED');
  registerInstalled(input.modId, input.version, manifest.dependencies || []);
  setContext(keyFor(input.modId, input.version), {
    manifest,
    grantedCapabilities: policy.grantedCapabilities,
    sandboxProfileId,
    instanceId: loaded.instanceId,
    state: 'INSTALLED',
    mode: input.mode,
  });
  setCapabilityBaseline(input.modId, policy.grantedCapabilities);
  stageTrail.push(makeDecision(input.modId, input.version, 'lifecycle', 'ALLOW', ['STATE_INSTALLED']));
  stageTrail.push(makeDecision(input.modId, input.version, 'audit', 'ALLOW', ['AUDIT_WRITTEN']));

  await persistStageTrail(stageTrail, 'KERNEL_INSTALL');
  return {
    state: 'INSTALLED',
    stageTrail,
  };
}
