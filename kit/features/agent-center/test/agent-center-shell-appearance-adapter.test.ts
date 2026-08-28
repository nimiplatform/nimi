import { describe, expect, it } from 'vitest';
import { createAgentCenterShellHostMechanics } from '../src/shell-appearance-adapter.js';

const avatarMaterial = {
  role: 'avatar' as const,
  backendKind: 'vrm' as const,
  fileName: 'avatar.vrm',
  mediaType: 'model/gltf-binary',
  content: Uint8Array.from([1, 2, 3]),
  sha256: 'a'.repeat(64),
  custodyRef: 'custody:new',
};

describe('Agent Center identity-free Host appearance mechanics', () => {
  it('projects avatar and background selections without forwarding product identity', async () => {
    const avatarCalls: unknown[][] = [];
    const backgroundMaterial = {
      role: 'background' as const,
      fileName: 'space.png',
      mediaType: 'image/png',
      content: Uint8Array.from([4, 5, 6]),
      sha256: 'b'.repeat(64),
      custodyRef: 'custody:background',
    };
    const mechanics = createAgentCenterShellHostMechanics({
      async pickAvatarAssetMaterial(...args) {
        avatarCalls.push(args);
        return avatarMaterial;
      },
      async pickBackgroundAssetMaterial() {
        return backgroundMaterial;
      },
    });

    await expect(mechanics.selectAvatar?.('vrm')).resolves.toEqual({
      intent: { backendKind: 'vrm' },
      importedAssets: [{
        role: 'avatar',
        fileName: 'avatar.vrm',
        mediaType: 'model/gltf-binary',
        content: Uint8Array.from([1, 2, 3]),
        sha256: 'a'.repeat(64),
      }],
    });
    await expect(mechanics.selectBackground?.()).resolves.toEqual({
      intent: {},
      importedAssets: [{
        role: 'background',
        fileName: 'space.png',
        mediaType: 'image/png',
        content: Uint8Array.from([4, 5, 6]),
        sha256: 'b'.repeat(64),
      }],
    });
    expect(avatarCalls).toEqual([['vrm']]);
    expect(JSON.stringify(avatarCalls)).not.toMatch(/agentHandle|accountId|ownerUserId|runtimeSourceRef|localAgentRef/u);
    expect(Object.keys(await mechanics.selectAvatar!('vrm'))).toEqual(['intent', 'importedAssets']);
  });

  it('fails closed when selection is canceled or the Host returns the wrong backend', async () => {
    const canceled = createAgentCenterShellHostMechanics({
      async pickAvatarAssetMaterial() { return null; },
    });
    await expect(canceled.selectAvatar?.('vrm')).rejects.toThrow(/canceled/u);

    const mismatched = createAgentCenterShellHostMechanics({
      async pickAvatarAssetMaterial() {
        return { ...avatarMaterial, backendKind: 'live2d' as const };
      },
    });
    await expect(mismatched.selectAvatar?.('vrm')).rejects.toThrow(/wrong backend/u);
  });
});
