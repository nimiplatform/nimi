import type {
  DesktopAgentAvatarResourceAssetPayload,
  DesktopAgentAvatarBindingRecord,
  DesktopAgentAvatarBindingSetInput,
  DesktopAgentAvatarImportLive2dInput,
  DesktopAgentAvatarImportResult,
  DesktopAgentAvatarResourceRelativeReadInput,
  DesktopAgentAvatarImportVrmInput,
  DesktopAgentAvatarResourceRecord,
} from './chat-agent-avatar-types.js';

const DESKTOP_AVATAR_STORE_DECOMMISSIONED_MESSAGE =
  'Desktop-local avatar import, binding, and asset loading were decommissioned in Wave 4 Exec Pack 4. Use Nimi Avatar as the only first-party avatar carrier.';

function decommissionedError(commandName: string): Error {
  return new Error(`${commandName} is unavailable: ${DESKTOP_AVATAR_STORE_DECOMMISSIONED_MESSAGE}`);
}

export function desktopAgentAvatarResourcesQueryKey() {
  return ['desktop-agent-avatar-resources'] as const;
}

export function desktopAgentAvatarBindingQueryKey(agentId: string) {
  return ['desktop-agent-avatar-binding', agentId] as const;
}

export async function pickDesktopAgentAvatarVrmSourcePath(): Promise<string | null> {
  throw decommissionedError('desktop_agent_avatar_resource_pick_vrm');
}

export async function pickDesktopAgentAvatarLive2dSourcePath(): Promise<string | null> {
  throw decommissionedError('desktop_agent_avatar_resource_pick_live2d');
}

export async function importDesktopAgentAvatarVrm(
  input: DesktopAgentAvatarImportVrmInput,
): Promise<DesktopAgentAvatarImportResult> {
  void input;
  throw decommissionedError('desktop_agent_avatar_resource_import_vrm');
}

export async function importDesktopAgentAvatarLive2d(
  input: DesktopAgentAvatarImportLive2dInput,
): Promise<DesktopAgentAvatarImportResult> {
  void input;
  throw decommissionedError('desktop_agent_avatar_resource_import_live2d');
}

export async function listDesktopAgentAvatarResources(): Promise<DesktopAgentAvatarResourceRecord[]> {
  throw decommissionedError('desktop_agent_avatar_resource_list');
}

export async function deleteDesktopAgentAvatarResource(resourceId: string): Promise<boolean> {
  void resourceId;
  throw decommissionedError('desktop_agent_avatar_resource_delete');
}

export async function readDesktopAgentAvatarResourceAsset(resourceId: string): Promise<DesktopAgentAvatarResourceAssetPayload> {
  void resourceId;
  throw decommissionedError('desktop_agent_avatar_resource_read_asset');
}

export async function readDesktopAgentAvatarResourceRelativeAsset(
  input: DesktopAgentAvatarResourceRelativeReadInput,
): Promise<DesktopAgentAvatarResourceAssetPayload> {
  void input;
  throw decommissionedError('desktop_agent_avatar_resource_read_relative_asset');
}

export async function getDesktopAgentAvatarBinding(agentId: string): Promise<DesktopAgentAvatarBindingRecord | null> {
  void agentId;
  throw decommissionedError('desktop_agent_avatar_binding_get');
}

export async function setDesktopAgentAvatarBinding(
  input: DesktopAgentAvatarBindingSetInput,
): Promise<DesktopAgentAvatarBindingRecord> {
  void input;
  throw decommissionedError('desktop_agent_avatar_binding_set');
}

export async function clearDesktopAgentAvatarBinding(agentId: string): Promise<boolean> {
  void agentId;
  throw decommissionedError('desktop_agent_avatar_binding_clear');
}
