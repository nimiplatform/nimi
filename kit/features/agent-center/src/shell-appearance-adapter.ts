import type {
  AgentCenterHostAppearanceSelection,
  AgentCenterHostMechanics,
  AgentCenterHostResourcePackSelection,
  AgentCenterPresentationAssetMaterial,
  AgentCenterPresentationIntent,
} from './types.js';

export type AgentCenterShellPickedAvatarMaterial = AgentCenterPresentationAssetMaterial & {
  readonly role: 'avatar';
  readonly backendKind: 'live2d' | 'vrm';
  readonly custodyRef: string;
};

export type AgentCenterShellPickedBackgroundMaterial = AgentCenterPresentationAssetMaterial & {
  readonly role: 'background';
  readonly custodyRef: string;
};

export type AgentCenterShellPickedResourcePackMaterial = AgentCenterPresentationAssetMaterial & {
  readonly role: 'resource-pack';
  readonly mediaType: 'application/vnd.nimi.resource-pack+zip';
  readonly custodyRef: string;
};

/**
 * Host-only selection and temporary-custody bridge. It receives only the
 * no Agent or owner identity and cannot commit Agent presentation state.
 */
export interface AgentCenterShellAppearanceBridge {
  readonly pickAvatarAssetMaterial: (
    backendKind: 'live2d' | 'vrm',
  ) => Promise<AgentCenterShellPickedAvatarMaterial | null>;
  readonly pickBackgroundAssetMaterial?: () => Promise<AgentCenterShellPickedBackgroundMaterial | null>;
  readonly pickResourcePackMaterial?: () => Promise<AgentCenterShellPickedResourcePackMaterial | null>;
}

/**
 * Adapts identity-free Host selection/custody into the canonical App Product
 * Plane mechanics contract. Runtime product state remains committed by the
 * shared Agent Center session after this helper returns.
 */
export function createAgentCenterShellHostMechanics(
  shell: AgentCenterShellAppearanceBridge,
): AgentCenterHostMechanics {
  return Object.freeze({
    async selectAvatar(
      kind: 'live2d' | 'vrm',
    ): Promise<AgentCenterHostAppearanceSelection> {
      const material = await shell.pickAvatarAssetMaterial(kind);
      if (!material) throw new Error('Agent Center avatar selection was canceled.');
      if (material.backendKind !== kind) {
        throw new Error('Shell returned appearance material for the wrong backend.');
      }
      return appearanceSelection(
        { backendKind: kind },
        presentationAssetMaterial(material),
      );
    },
    ...(shell.pickBackgroundAssetMaterial ? {
      async selectBackground(): Promise<AgentCenterHostAppearanceSelection> {
        const material = await shell.pickBackgroundAssetMaterial!();
        if (!material) throw new Error('Agent Center background selection was canceled.');
        return appearanceSelection({}, presentationAssetMaterial(material));
      },
    } : {}),
    ...(shell.pickResourcePackMaterial ? {
      async selectResourcePack(): Promise<AgentCenterHostResourcePackSelection | null> {
        const material = await shell.pickResourcePackMaterial!();
        if (!material) return null;
        return presentationAssetMaterial(material) as AgentCenterHostResourcePackSelection;
      },
    } : {}),
  });
}

function appearanceSelection(
  intent: AgentCenterPresentationIntent,
  material: AgentCenterPresentationAssetMaterial,
): AgentCenterHostAppearanceSelection {
  return Object.freeze({
    intent: Object.freeze({ ...intent }),
    importedAssets: Object.freeze([Object.freeze(material)]),
  });
}

function presentationAssetMaterial(
  material: AgentCenterPresentationAssetMaterial,
): AgentCenterPresentationAssetMaterial {
  const base = {
    fileName: material.fileName,
    content: Uint8Array.from(material.content),
    sha256: material.sha256,
  };
  return material.role === 'resource-pack'
    ? { ...base, role: material.role, mediaType: material.mediaType }
    : { ...base, role: material.role, mediaType: material.mediaType };
}
