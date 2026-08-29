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
  it('projects avatar and background selections without forwarding raw identity', async () => {
    const avatarCalls: unknown[][] = [];
    const backgroundMaterial = {
      role: 'background' as const,
      fileName: 'space.png',
      mediaType: 'image/png',
      content: Uint8Array.from([4, 5, 6]),
      sha256: 'b'.repeat(64),
      custodyRef: 'custody:background',
    };
    const resourcePackContent = Uint8Array.from([7, 8, 9]);
    const mechanics = createAgentCenterShellHostMechanics({
      async pickAvatarAssetMaterial(...args) {
        avatarCalls.push(args);
        return avatarMaterial;
      },
      async pickBackgroundAssetMaterial() {
        return backgroundMaterial;
      },
      async pickResourcePackMaterial() {
        return {
          role: 'resource-pack' as const,
          fileName: 'technical-pack-a.nimipack',
          mediaType: 'application/vnd.nimi.resource-pack+zip' as const,
          content: resourcePackContent,
          sha256: 'c'.repeat(64),
          custodyRef: 'custody:resource-pack',
        };
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
    const resourcePack = await mechanics.selectResourcePack?.();
    resourcePackContent[0] = 255;
    expect(resourcePack).toEqual({
      role: 'resource-pack',
      fileName: 'technical-pack-a.nimipack',
      mediaType: 'application/vnd.nimi.resource-pack+zip',
      content: Uint8Array.from([7, 8, 9]),
      sha256: 'c'.repeat(64),
    });
    expect(resourcePack).not.toHaveProperty('custodyRef');
    expect(avatarCalls).toEqual([['vrm']]);
    expect(JSON.stringify(avatarCalls)).not.toMatch(/accountId|ownerUserId|runtimeSourceRef|localAgentRef/u);
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

  it('treats a canceled Resource Pack picker as a no-op', async () => {
    const canceled = createAgentCenterShellHostMechanics({
      async pickAvatarAssetMaterial() { return null; },
      async pickResourcePackMaterial() { return null; },
    });
    await expect(canceled.selectResourcePack?.()).resolves.toBeNull();
  });
});
