import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RuntimeDefaultExperienceTransportError,
  createRuntimeDefaultExperienceTransport,
  resolveDefaultExperienceMaterializationState,
} from '../src/scope/default-experience/index.js';
import type {
  RuntimeDefaultExperienceProfileRow,
} from '../src/scope/default-experience/index.js';
import type { RuntimeLocalServiceClient } from '../src/runtime/index.js';
import type { LocalDeviceProfile } from '../src/runtime/generated/runtime/v1/local_runtime_types.js';

const windowsNvidiaProfile: LocalDeviceProfile = {
  os: 'windows',
  arch: 'amd64',
  gpu: {
    available: true,
    vendor: 'NVIDIA',
    model: 'RTX',
    totalVramBytes: '12000000000',
    availableVramBytes: '8000000000',
    memoryModel: 0,
  },
  python: { available: true, version: '3.12' },
  npu: { available: false, ready: false, vendor: '', runtime: '', detail: '' },
  diskFreeBytes: '100000000000',
  ports: [],
  totalRamBytes: '32000000000',
  availableRamBytes: '16000000000',
};

const profiles: readonly RuntimeDefaultExperienceProfileRow[] = [
  {
    alias: 'cloud-first',
    privacyPosture: 'cloud-ok',
    computePosture: 'cloud-only',
    capabilitySet: ['text.generate'],
    routingPolicy: 'cloud-first',
    hostCapabilityProfileRefs: ['windows-amd64-nvidia-cuda', 'windows-amd64-cpu'],
    applicableScopes: ['first-run'],
    materializationConfirmationRequired: false,
    sourceRule: 'P-DXP-002',
    localComputePackRefs: [],
  },
  {
    alias: 'local-gpu',
    privacyPosture: 'local-preferred',
    computePosture: 'cuda-capable',
    capabilitySet: ['text.generate', 'image.generate'],
    routingPolicy: 'local-first',
    hostCapabilityProfileRefs: ['windows-amd64-nvidia-cuda'],
    applicableScopes: ['first-run', 'first-party-app'],
    materializationConfirmationRequired: true,
    sourceRule: 'P-DXP-002',
    localComputePackRefs: ['local-gpu-support'],
  },
];

function runtimeWithActivation(state = 'ready'): Pick<
  RuntimeLocalServiceClient,
  'collectDeviceProfile' | 'resolveLocalEnvironmentActivationGate'
> {
  return {
    async collectDeviceProfile() {
      return { profile: windowsNvidiaProfile };
    },
    async resolveLocalEnvironmentActivationGate(request) {
      return {
        gate: {
          consumerId: request.consumerId,
          packId: request.packId,
          state,
          reasonCode: state.toUpperCase(),
          detail: `gate ${state}`,
          blockingDependencies: [],
          dependencies: [],
        },
      };
    },
  };
}

describe('Runtime Default Experience transport', () => {
  it('maps Runtime device profile to HostProfile', async () => {
    const transport = createRuntimeDefaultExperienceTransport({
      localRuntime: runtimeWithActivation(),
      loadProfiles: () => profiles,
    });
    const host = await transport.hostProfile();
    assert.equal(host.profileId, 'windows-amd64-nvidia-cuda');
    assert.equal(host.acceleratorVendor, 'NVIDIA');
    assert.deepEqual(host.acceleratorPlanes, ['windows-amd64-nvidia-cuda', 'windows-amd64-cpu']);
  });

  it('recommends a matching profile using host profile and preferences', async () => {
    const transport = createRuntimeDefaultExperienceTransport({
      localRuntime: runtimeWithActivation(),
      loadProfiles: () => profiles,
    });
    const selected = await transport.recommendProfile('first-run', { preferredCompute: 'cuda-capable' });
    assert.equal(selected.alias, 'local-gpu');
  });

  it('fails closed when profile catalog is missing', async () => {
    const transport = createRuntimeDefaultExperienceTransport({
      localRuntime: runtimeWithActivation(),
      loadProfiles: () => [],
    });
    await assert.rejects(transport.recommendProfile('first-run'), RuntimeDefaultExperienceTransportError);
  });

  it('does not pretend to apply AIConfig without a host-owned callback', async () => {
    const transport = createRuntimeDefaultExperienceTransport({
      localRuntime: runtimeWithActivation(),
      loadProfiles: () => profiles,
    });
    await assert.rejects(
      transport.applyProfile({ kind: 'first-run', id: 'first-run' }, 'local-gpu'),
      (error: unknown) => {
        assert.ok(error instanceof RuntimeDefaultExperienceTransportError);
        assert.equal(error.code, 'unsupported-apply');
        return true;
      },
    );
  });

  it('uses host-owned applyProfile callback when provided', async () => {
    const transport = createRuntimeDefaultExperienceTransport({
      localRuntime: runtimeWithActivation(),
      loadProfiles: () => profiles,
      applyProfile: async (scope, profileId) => ({ applied: true, profileId, scope }),
    });
    const result = await transport.applyProfile({ kind: 'first-run', id: 'first-run' }, 'local-gpu');
    assert.equal(result.applied, true);
    assert.equal(result.profileId, 'local-gpu');
  });

  it('maps Runtime activation gate states into cold-start readiness', async () => {
    const projection = await resolveDefaultExperienceMaterializationState(
      runtimeWithActivation('setup_required'),
      profiles[1]!,
      { consumerId: 'nimi-home' },
    );
    assert.equal(projection.state, 'setup-required');
    assert.equal(projection.detail, 'gate setup_required');
  });
});
