export type DesktopAgentAvatarResourceKind = 'vrm' | 'live2d';
export type DesktopAgentAvatarResourceStatus = 'ready' | 'invalid' | 'missing';

export type DesktopAgentAvatarResourceRecord = {
  resourceId: string;
  kind: DesktopAgentAvatarResourceKind;
  displayName: string;
  sourceFilename: string;
  storedPath: string;
  fileUrl: string;
  posterPath: string | null;
  importedAtMs: number;
  updatedAtMs: number;
  status: DesktopAgentAvatarResourceStatus;
};

export type DesktopAgentAvatarBindingRecord = {
  agentId: string;
  resourceId: string;
  updatedAtMs: number;
};

export type DesktopAgentAvatarResourceAssetPayload = {
  mimeType: string;
  base64: string;
};

export type DesktopAgentAvatarImportResult = {
  resource: DesktopAgentAvatarResourceRecord;
  binding: DesktopAgentAvatarBindingRecord | null;
};

export type DesktopAgentAvatarImportVrmInput = {
  sourcePath: string;
  displayName?: string | null;
  bindAgentId?: string | null;
  importedAtMs?: number | null;
};

export type DesktopAgentAvatarImportLive2dInput = {
  sourcePath: string;
  displayName?: string | null;
  bindAgentId?: string | null;
  importedAtMs?: number | null;
};

export type DesktopAgentAvatarBindingSetInput = {
  agentId: string;
  resourceId: string;
  updatedAtMs: number;
};
