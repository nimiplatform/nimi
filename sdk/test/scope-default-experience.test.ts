import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DefaultExperienceClient,
  DefaultExperienceClientError,
} from '../src/scope/default-experience/index.js';
import type {
  ApplicableScope,
  ApplyResult,
  ColdStartProjection,
  DefaultExperienceProfile,
  DefaultExperienceTransport,
  HostProfile,
  ProfilePreferences,
  ScopeRef,
  UpstreamInputs,
} from '../src/scope/default-experience/index.js';

class StubTransport implements DefaultExperienceTransport {
  constructor(
    private readonly behavior: {
      readonly host?: HostProfile | Error | null;
      readonly recommend?: DefaultExperienceProfile | Error | null;
      readonly apply?: ApplyResult | Error | null;
      readonly project?: ColdStartProjection | Error | { state: unknown };
    } = {},
  ) {}

  async hostProfile(): Promise<HostProfile> {
    if (this.behavior.host instanceof Error) throw this.behavior.host;
    if (this.behavior.host === null) return null as unknown as HostProfile;
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
    if (this.behavior.recommend instanceof Error) throw this.behavior.recommend;
    if (this.behavior.recommend === null) return null as unknown as DefaultExperienceProfile;
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
    if (this.behavior.apply instanceof Error) throw this.behavior.apply;
    if (this.behavior.apply === null) return null as unknown as ApplyResult;
    if (this.behavior.apply) return this.behavior.apply;
    return { applied: true, profileId, scope: scopeRef };
  }

  async projectColdStart(_inputs: UpstreamInputs): Promise<ColdStartProjection> {
    if (this.behavior.project instanceof Error) throw this.behavior.project;
    if (this.behavior.project) return this.behavior.project as ColdStartProjection;
    return { state: 'ready' };
  }
}

const allReady: UpstreamInputs = {
  runtimeDaemon: 'ready',
  account: 'ready',
  defaultExperienceProfile: 'ready',
  materialization: 'ready',
  appRegistry: 'ready',
  cognitionMemory: 'ready',
};

const sampleScope: ScopeRef = { kind: 'first-run', id: 'first-run-test' };

describe('DefaultExperienceClient', () => {
  it('rejects null transport at construction', () => {
    assert.throws(() => new DefaultExperienceClient(null as unknown as DefaultExperienceTransport), DefaultExperienceClientError);
  });

  it('hostProfile returns valid profile from transport', async () => {
    const client = new DefaultExperienceClient(new StubTransport());
    const profile = await client.hostProfile();
    assert.equal(profile.profileId, 'darwin-arm64-metal');
    assert.equal(profile.platform.os, 'darwin');
  });

  it('hostProfile rejects response missing profileId', async () => {
    const client = new DefaultExperienceClient(new StubTransport({ host: { profileId: '', platform: { os: 'x', arch: 'y' } } }));
    await assert.rejects(client.hostProfile(), DefaultExperienceClientError);
  });

  it('hostProfile rejects response missing platform', async () => {
    const client = new DefaultExperienceClient(new StubTransport({ host: { profileId: 'x' } as unknown as HostProfile }));
    await assert.rejects(client.hostProfile(), DefaultExperienceClientError);
  });

  it('hostProfile wraps transport errors as DefaultExperienceClientError', async () => {
    const client = new DefaultExperienceClient(new StubTransport({ host: new Error('boom') }));
    await assert.rejects(client.hostProfile(), (err: unknown) => {
      assert.ok(err instanceof DefaultExperienceClientError);
      assert.equal((err as DefaultExperienceClientError).code, 'transport-error');
      return true;
    });
  });

  it('recommendProfile rejects unknown applicable scope', async () => {
    const client = new DefaultExperienceClient(new StubTransport());
    await assert.rejects(client.recommendProfile('mod-install' as unknown as ApplicableScope), DefaultExperienceClientError);
  });

  it('recommendProfile returns valid profile', async () => {
    const client = new DefaultExperienceClient(new StubTransport());
    const profile = await client.recommendProfile('first-run');
    assert.equal(profile.alias, 'cloud-first');
    assert.equal(profile.privacyPosture, 'cloud-ok');
  });

  it('recommendProfile rejects non-canonical privacyPosture in response', async () => {
    const bad: DefaultExperienceProfile = {
      alias: 'rogue',
      privacyPosture: 'cloud-maybe' as 'cloud-ok',
      computePosture: 'cloud-only',
      capabilitySet: [],
      routingPolicy: 'cloud-first',
      hostCapabilityProfileRefs: [],
      applicableScopes: ['first-run'],
      materializationConfirmationRequired: false,
      sourceRule: 'P-DXP-002',
    };
    const client = new DefaultExperienceClient(new StubTransport({ recommend: bad }));
    await assert.rejects(client.recommendProfile('first-run'), DefaultExperienceClientError);
  });

  it('recommendProfile rejects non-canonical applicableScopes in response', async () => {
    const bad: DefaultExperienceProfile = {
      alias: 'rogue',
      privacyPosture: 'cloud-ok',
      computePosture: 'cloud-only',
      capabilitySet: [],
      routingPolicy: 'cloud-first',
      hostCapabilityProfileRefs: [],
      applicableScopes: ['first-run', 'mod-install' as 'first-run'],
      materializationConfirmationRequired: false,
      sourceRule: 'P-DXP-002',
    };
    const client = new DefaultExperienceClient(new StubTransport({ recommend: bad }));
    await assert.rejects(client.recommendProfile('first-run'), DefaultExperienceClientError);
  });

  it('recommendProfile wraps transport errors', async () => {
    const client = new DefaultExperienceClient(new StubTransport({ recommend: new Error('boom') }));
    await assert.rejects(client.recommendProfile('first-run'), (err: unknown) => {
      assert.ok(err instanceof DefaultExperienceClientError);
      assert.equal((err as DefaultExperienceClientError).code, 'transport-error');
      return true;
    });
  });

  it('applyProfile rejects missing scope id', async () => {
    const client = new DefaultExperienceClient(new StubTransport());
    await assert.rejects(
      client.applyProfile({ kind: 'first-run', id: '' }, 'cloud-first'),
      DefaultExperienceClientError,
    );
  });

  it('applyProfile rejects missing profileId', async () => {
    const client = new DefaultExperienceClient(new StubTransport());
    await assert.rejects(client.applyProfile(sampleScope, ''), DefaultExperienceClientError);
  });

  it('applyProfile returns applied result on happy path', async () => {
    const client = new DefaultExperienceClient(new StubTransport());
    const result = await client.applyProfile(sampleScope, 'cloud-first');
    assert.equal(result.applied, true);
    assert.equal(result.profileId, 'cloud-first');
  });

  it('applyProfile rejects response missing applied boolean', async () => {
    const client = new DefaultExperienceClient(new StubTransport({ apply: { profileId: 'x', scope: sampleScope } as unknown as ApplyResult }));
    await assert.rejects(client.applyProfile(sampleScope, 'cloud-first'), DefaultExperienceClientError);
  });

  it('applyProfile wraps transport errors', async () => {
    const client = new DefaultExperienceClient(new StubTransport({ apply: new Error('boom') }));
    await assert.rejects(client.applyProfile(sampleScope, 'cloud-first'), (err: unknown) => {
      assert.ok(err instanceof DefaultExperienceClientError);
      assert.equal((err as DefaultExperienceClientError).code, 'transport-error');
      return true;
    });
  });

  it('projectColdStart rejects non-canonical upstream state', async () => {
    const client = new DefaultExperienceClient(new StubTransport());
    const bad: UpstreamInputs = { ...allReady, account: 'active_ready' as 'ready' };
    await assert.rejects(client.projectColdStart(bad), DefaultExperienceClientError);
  });

  it('projectColdStart returns canonical projection on happy path', async () => {
    const client = new DefaultExperienceClient(new StubTransport());
    const projection = await client.projectColdStart(allReady);
    assert.equal(projection.state, 'ready');
  });

  it('projectColdStart rejects non-canonical state in response', async () => {
    const client = new DefaultExperienceClient(new StubTransport({ project: { state: 'active_ready' } as unknown as ColdStartProjection }));
    await assert.rejects(client.projectColdStart(allReady), DefaultExperienceClientError);
  });

  it('projectColdStart wraps transport errors', async () => {
    const client = new DefaultExperienceClient(new StubTransport({ project: new Error('boom') }));
    await assert.rejects(client.projectColdStart(allReady), (err: unknown) => {
      assert.ok(err instanceof DefaultExperienceClientError);
      assert.equal((err as DefaultExperienceClientError).code, 'transport-error');
      return true;
    });
  });

  it('SDK default-experience module embeds no provider/model identifier string constants', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const sources = [
      resolve(import.meta.dirname, '../src/scope/default-experience/types.ts'),
      resolve(import.meta.dirname, '../src/scope/default-experience/transport.ts'),
      resolve(import.meta.dirname, '../src/scope/default-experience/client.ts'),
      resolve(import.meta.dirname, '../src/scope/default-experience/index.ts'),
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
});
