import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DefaultExperienceBridge } from '../src/runtime/default-experience-bridge/index.js';
import type {
  ApplicableScope,
  ApplyResult,
  ColdStartProjection,
  ColdStartState,
  DefaultExperienceProfile,
  HostProfile,
  ProfilePreferences,
  ScopeRef,
  UpstreamInputs,
} from '../src/runtime/default-experience-bridge/index.js';
import type { RuntimeAdapter } from '../src/runtime/default-experience-bridge/index.js';

const allReady: UpstreamInputs = {
  runtimeDaemon: 'ready',
  account: 'ready',
  defaultExperienceProfile: 'ready',
  materialization: 'ready',
  appRegistry: 'ready',
  cognitionMemory: 'ready',
};

const sampleScopeRef: ScopeRef = { kind: 'first-run', id: 'first-run-1' };

class StubAdapter implements RuntimeAdapter {
  recommendCalls = 0;
  applyCalls = 0;
  hostCalls = 0;
  projectCalls = 0;

  constructor(
    private readonly behavior: {
      readonly host?: HostProfile | Error;
      readonly recommend?: DefaultExperienceProfile | Error | null;
      readonly apply?: ApplyResult | Error | null;
      readonly project?: ColdStartProjection | Error | { state: unknown };
    } = {},
  ) {}

  async hostProfile(): Promise<HostProfile> {
    this.hostCalls += 1;
    if (this.behavior.host instanceof Error) throw this.behavior.host;
    if (this.behavior.host) return this.behavior.host;
    return {
      profileId: 'darwin-arm64-metal',
      platform: { os: 'darwin', arch: 'arm64' },
    };
  }

  async recommendProfile(
    _scope: ApplicableScope,
    _preferences?: ProfilePreferences,
  ): Promise<DefaultExperienceProfile> {
    this.recommendCalls += 1;
    if (this.behavior.recommend instanceof Error) throw this.behavior.recommend;
    if (this.behavior.recommend === null) {
      return {
        alias: '',
        privacyPosture: 'cloud-ok',
        computePosture: 'cloud-only',
        capabilitySet: [],
        routingPolicy: 'cloud-first',
        hostCapabilityProfileRefs: [],
        applicableScopes: ['first-run'],
        materializationConfirmationRequired: false,
        sourceRule: 'P-DXP-002',
      };
    }
    if (this.behavior.recommend) return this.behavior.recommend;
    return {
      alias: 'cloud-first',
      privacyPosture: 'cloud-ok',
      computePosture: 'cloud-only',
      capabilitySet: ['text.generate'],
      routingPolicy: 'cloud-first',
      hostCapabilityProfileRefs: ['darwin-arm64-metal'],
      applicableScopes: ['first-run', 'first-party-app', 'scope-bound-apply'],
      materializationConfirmationRequired: false,
      sourceRule: 'P-DXP-002',
    };
  }

  async applyProfile(scopeRef: ScopeRef, profileId: string): Promise<ApplyResult> {
    this.applyCalls += 1;
    if (this.behavior.apply instanceof Error) throw this.behavior.apply;
    if (this.behavior.apply === null) {
      return { applied: false, profileId, scope: scopeRef };
    }
    if (this.behavior.apply) return this.behavior.apply;
    return { applied: true, profileId, scope: scopeRef };
  }

  async projectColdStart(_inputs: UpstreamInputs): Promise<ColdStartProjection> {
    this.projectCalls += 1;
    if (this.behavior.project instanceof Error) throw this.behavior.project;
    if (this.behavior.project) {
      return this.behavior.project as ColdStartProjection;
    }
    return { state: 'ready' };
  }
}

test('DefaultExperienceBridge constructor rejects null adapter', () => {
  assert.throws(() => new DefaultExperienceBridge(null as unknown as RuntimeAdapter));
});

test('DefaultExperienceBridge.applyDefaultProfile returns applied on happy path', async () => {
  const adapter = new StubAdapter();
  const bridge = new DefaultExperienceBridge(adapter);
  const result = await bridge.applyDefaultProfile(sampleScopeRef, 'first-run');
  assert.equal(result.status, 'applied');
  if (result.status === 'applied') {
    assert.equal(result.value.applied, true);
    assert.equal(result.value.profileId, 'cloud-first');
    assert.equal(result.value.scope.id, 'first-run-1');
  }
  assert.equal(adapter.recommendCalls, 1);
  assert.equal(adapter.applyCalls, 1);
});

test('DefaultExperienceBridge.applyDefaultProfile fails closed when recommend throws', async () => {
  const adapter = new StubAdapter({ recommend: new Error('recommend boom') });
  const bridge = new DefaultExperienceBridge(adapter);
  const result = await bridge.applyDefaultProfile(sampleScopeRef, 'first-run');
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') {
    assert.equal(result.state, 'unavailable');
    assert.match(result.detail, /recommend boom/);
  }
  assert.equal(adapter.applyCalls, 0);
});

test('DefaultExperienceBridge.applyDefaultProfile fails closed when apply throws', async () => {
  const adapter = new StubAdapter({ apply: new Error('apply boom') });
  const bridge = new DefaultExperienceBridge(adapter);
  const result = await bridge.applyDefaultProfile(sampleScopeRef, 'first-run');
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') {
    assert.equal(result.state, 'failed');
    assert.match(result.detail, /apply boom/);
  }
});

test('DefaultExperienceBridge.applyDefaultProfile fails closed when apply returns non-applied', async () => {
  const adapter = new StubAdapter({ apply: null });
  const bridge = new DefaultExperienceBridge(adapter);
  const result = await bridge.applyDefaultProfile(sampleScopeRef, 'first-run');
  assert.equal(result.status, 'blocked');
});

test('DefaultExperienceBridge.applyDefaultProfile fails closed when recommend returns empty alias', async () => {
  const adapter = new StubAdapter({ recommend: null });
  const bridge = new DefaultExperienceBridge(adapter);
  const result = await bridge.applyDefaultProfile(sampleScopeRef, 'first-run');
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') {
    assert.equal(result.state, 'failed');
  }
  assert.equal(adapter.applyCalls, 0);
});

test('DefaultExperienceBridge.projectReadiness returns ready when all upstreams ready and adapter agrees', async () => {
  const adapter = new StubAdapter();
  const bridge = new DefaultExperienceBridge(adapter);
  const projection = await bridge.projectReadiness(allReady);
  assert.equal(projection.state, 'ready');
  assert.equal(adapter.projectCalls, 1);
});

test('DefaultExperienceBridge.projectReadiness never projects ready when any upstream is not ready', async () => {
  const adapter = new StubAdapter();
  const bridge = new DefaultExperienceBridge(adapter);
  const nonReadyStates: ColdStartState[] = [
    'unavailable',
    'setup-required',
    'needs-confirmation',
    'in-progress',
    'failed',
    'unsupported',
    'stale-projection',
  ];
  for (const state of nonReadyStates) {
    const projection = await bridge.projectReadiness({ ...allReady, account: state });
    assert.notEqual(projection.state, 'ready', `account=${state} must not project ready`);
    assert.equal(projection.reasonOwner, 'account');
  }
});

test('DefaultExperienceBridge.projectReadiness fails closed when adapter throws', async () => {
  const adapter = new StubAdapter({ project: new Error('project boom') });
  const bridge = new DefaultExperienceBridge(adapter);
  const projection = await bridge.projectReadiness(allReady);
  assert.equal(projection.state, 'unavailable');
  assert.match(projection.detail ?? '', /project boom/);
});

test('DefaultExperienceBridge.projectReadiness fails closed on non-canonical state from adapter', async () => {
  const adapter = new StubAdapter({ project: { state: 'active_ready' } as unknown as ColdStartProjection });
  const bridge = new DefaultExperienceBridge(adapter);
  const projection = await bridge.projectReadiness(allReady);
  assert.equal(projection.state, 'unavailable');
  assert.match(projection.detail ?? '', /non-canonical/);
});

test('DefaultExperienceBridge.projectReadiness normalizes non-canonical upstream state to unavailable (fail-closed cast bypass)', async () => {
  const adapter = new StubAdapter();
  const bridge = new DefaultExperienceBridge(adapter);
  // Simulate an upstream that crossed an untrusted boundary and arrived
  // with a non-canonical state (e.g., cast from a string). The bridge
  // must NOT propagate that string to consumers; it must normalize to
  // 'unavailable' and never claim ready.
  const projection = await bridge.projectReadiness({
    ...allReady,
    account: 'active_ready' as 'ready',
  });
  assert.equal(projection.state, 'unavailable');
  assert.equal(projection.reasonOwner, 'account');
  assert.notEqual(projection.state, 'ready');
  // Detail must reference the unavailable state (post-normalization) — not the original cast.
  assert.match(projection.detail ?? '', /unavailable/);
});

test('DefaultExperienceBridge.projectReadiness uses worst-state-wins for multiple non-ready upstreams', async () => {
  const adapter = new StubAdapter();
  const bridge = new DefaultExperienceBridge(adapter);
  const projection = await bridge.projectReadiness({
    ...allReady,
    account: 'failed',
    materialization: 'unsupported',
  });
  // unsupported has higher priority than failed
  assert.equal(projection.state, 'unsupported');
  assert.equal(projection.reasonOwner, 'materialization');
  assert.equal(adapter.projectCalls, 0); // short-circuits because upstream not ready
});

test('DefaultExperienceBridge source contains no provider/model identifier string constants', () => {
  // Source inspection: the bridge module must not embed identifiers
  // forbidden by P-DXP-008. This is a positive-fixture style test that
  // mirrors the CI gate `check:no-default-experience-provider-model-constants`.
  const sources = [
    resolve(import.meta.dirname, '../src/runtime/default-experience-bridge/bridge.ts'),
    resolve(import.meta.dirname, '../src/runtime/default-experience-bridge/types.ts'),
    resolve(import.meta.dirname, '../src/runtime/default-experience-bridge/runtime-adapter.ts'),
    resolve(import.meta.dirname, '../src/runtime/default-experience-bridge/index.ts'),
  ];
  const forbidden =
    /\b(openai|anthropic|claude(?:-[a-z0-9-]+)?|gpt(?:-[a-z0-9.]+)?|gemini(?:-[a-z0-9.-]+)?|deepseek(?:-[a-z0-9.-]+)?|qwen(?:[0-9a-z.-]+)?|mistral(?:-[a-z0-9.-]+)?|llama(?:[.-][a-z0-9.-]+)?|ollama|llamacpp|vllm)\b/i;
  const stringLiteral = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
  for (const sourcePath of sources) {
    const source = readFileSync(sourcePath, 'utf8');
    let match: RegExpExecArray | null;
    stringLiteral.lastIndex = 0;
    while ((match = stringLiteral.exec(source)) !== null) {
      const literal = match[2];
      if (literal && forbidden.test(literal)) {
        assert.fail(`forbidden identifier "${literal}" found in ${sourcePath}`);
      }
    }
  }
});
