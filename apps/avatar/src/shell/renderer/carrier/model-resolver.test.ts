import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeAvatarHostCommandMock = vi.fn();

vi.mock('../app-shell/avatar-host-bridge.js', () => ({
  invokeAvatarHostCommand: (...args: unknown[]) => invokeAvatarHostCommandMock(...args),
}));

describe('Runtime presentation Avatar asset resolver', () => {
  beforeEach(() => invokeAvatarHostCommandMock.mockReset());

  it('binds native materialization to the exact presentation revision', async () => {
    invokeAvatarHostCommandMock.mockResolvedValue({
      materializationRef: 'agent-center-avatar-asset:id_account:id_agent:vrm:vrm_222222222222',
      materializationLeaseRef: `avatar_materialization_lease_${'a'.repeat(32)}`,
      manifest: {
        kind: 'vrm',
        runtime_dir: '/avatar/runtime',
        model_id: 'avatar',
        model3_json_path: null,
        vrm_file_path: '/avatar/runtime/avatar.vrm',
        nimi_dir: null,
        motion_presets_dir: null,
        adapter_manifest_path: null,
        live2d_calibration_ref: null,
      },
    });
    const { resolveRuntimePresentationAvatarAsset } = await import('./model-resolver.js');

    await resolveRuntimePresentationAvatarAsset({
      agentHandle: `agent_ref_${'b'.repeat(43)}`,
      presentationRevision: 'revision-9',
      presentationProfile: {
        backendKind: 'vrm',
        avatarAssetRef: 'vrm_222222222222',
      } as never,
    });

    expect(invokeAvatarHostCommandMock).toHaveBeenCalledWith(
      'nimi_avatar_resolve_agent_center_avatar_asset',
      {
        payload: {
          agentHandle: `agent_ref_${'b'.repeat(43)}`,
          avatarAssetRef: 'vrm_222222222222',
          backendKind: 'vrm',
          presentationRevision: 'revision-9',
        },
      },
    );
  });

  it('rejects a missing current presentation revision before invoking the Host', async () => {
    const { resolveRuntimePresentationAvatarAsset } = await import('./model-resolver.js');

    await expect(resolveRuntimePresentationAvatarAsset({
      agentHandle: `agent_ref_${'b'.repeat(43)}`,
      presentationRevision: '   ',
      presentationProfile: {
        backendKind: 'vrm',
        avatarAssetRef: 'vrm_222222222222',
      } as never,
    })).rejects.toThrow('Avatar presentation revision is required');
    expect(invokeAvatarHostCommandMock).not.toHaveBeenCalled();
  });

  it('commits the exact resolved presentation tuple and rejects a mismatched Host result', async () => {
    invokeAvatarHostCommandMock.mockResolvedValue({
      accepted: true,
      materializationRef: 'avatar-materialization:vrm:vrm_222222222222',
    });
    const { commitRuntimePresentationMaterializationLease } = await import('./model-resolver.js');
    const input = {
      materializationLeaseRef: `avatar_materialization_lease_${'a'.repeat(32)}`,
      materializationRef: 'avatar-materialization:vrm:vrm_222222222222',
      avatarAssetRef: 'vrm_222222222222',
      backendKind: 'vrm' as const,
      presentationRevision: 'revision-9',
    };

    await commitRuntimePresentationMaterializationLease(input);
    expect(invokeAvatarHostCommandMock).toHaveBeenCalledWith(
      'nimi_avatar_commit_materialization_lease',
      input,
    );

    invokeAvatarHostCommandMock.mockResolvedValueOnce({
      accepted: true,
      materializationRef: 'avatar-materialization:vrm:vrm_333333333333',
    });
    await expect(commitRuntimePresentationMaterializationLease(input))
      .rejects.toThrow('Avatar Host did not commit the exact materialization lease');
  });
});
