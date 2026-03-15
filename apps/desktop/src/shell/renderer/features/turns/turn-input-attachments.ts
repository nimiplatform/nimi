export type PendingAttachmentKind = 'image' | 'video';

export type PendingAttachment = {
  file: File;
  kind: PendingAttachmentKind;
  previewUrl: string;
  name: string;
};

type PendingAttachmentDeps = {
  createObjectUrl: (file: File) => string;
  revokeObjectUrl: (url: string) => void;
};

type TurnInputSendPlanInput = {
  text: string;
  pendingAttachments: PendingAttachment[];
  hasSelectedChat: boolean;
  isReadOnly: boolean;
  isSending: boolean;
  isUploading: boolean;
};

type TurnInputSendPlan = {
  canSend: boolean;
  sendText: boolean;
  sendAttachment: boolean;
};

export function formatPendingAttachmentSize(sizeInBytes: number): string {
  if (!Number.isFinite(sizeInBytes) || sizeInBytes <= 0) {
    return '0 B';
  }

  if (sizeInBytes < 1024) {
    return `${Math.round(sizeInBytes)} B`;
  }

  const sizeInKb = sizeInBytes / 1024;
  if (sizeInKb < 1024) {
    return `${sizeInKb.toFixed(1)} KB`;
  }

  return `${(sizeInKb / 1024).toFixed(1)} MB`;
}

export function resolvePendingAttachmentKind(file: Pick<File, 'type'>): PendingAttachmentKind | null {
  const mimeType = String(file.type || '').toLowerCase();
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  return null;
}

export function buildPendingAttachment(file: File, previewUrl: string): PendingAttachment | null {
  const kind = resolvePendingAttachmentKind(file);
  if (!kind) {
    return null;
  }

  return {
    file,
    kind,
    previewUrl,
    name: String(file.name || '').trim() || (kind === 'image' ? 'image' : 'video'),
  };
}

export function appendPendingAttachment(
  current: PendingAttachment[],
  nextFile: File,
  deps: PendingAttachmentDeps,
): PendingAttachment[] | null {
  const previewUrl = deps.createObjectUrl(nextFile);
  const next = buildPendingAttachment(nextFile, previewUrl);
  if (!next) {
    deps.revokeObjectUrl(previewUrl);
    return null;
  }

  return [...current, next];
}

export function removePendingAttachmentAt(
  current: PendingAttachment[],
  index: number,
  revokeObjectUrl: (url: string) => void,
): PendingAttachment[] {
  const target = current[index];
  if (index < 0 || index >= current.length || !target) {
    return current;
  }

  revokeObjectUrl(target.previewUrl);
  return current.filter((_, currentIndex) => currentIndex !== index);
}

export function clearPendingAttachments(
  current: PendingAttachment[],
  revokeObjectUrl: (url: string) => void,
): [] {
  for (const attachment of current) {
    revokeObjectUrl(attachment.previewUrl);
  }
  return [];
}

export function getTurnInputSendPlan(input: TurnInputSendPlanInput): TurnInputSendPlan {
  const hasText = Boolean(input.text.trim());
  const hasAttachment = input.pendingAttachments.length > 0;
  const isBlocked = !input.hasSelectedChat
    || input.isReadOnly
    || input.isSending
    || input.isUploading;

  return {
    canSend: !isBlocked && (hasText || hasAttachment),
    sendText: !isBlocked && hasText,
    sendAttachment: !isBlocked && hasAttachment,
  };
}
