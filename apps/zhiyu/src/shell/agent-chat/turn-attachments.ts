export type ZhiyuPendingAttachment = {
  readonly file: File;
  readonly previewUrl: string;
  readonly name: string;
};

export type ZhiyuChatAttachmentRef = {
  readonly artifactId: string;
  readonly displayName?: string;
  readonly mediaUrl?: string;
  readonly mediaMimeType?: string;
};

export type ZhiyuAttachmentObjectUrlDeps = {
  readonly createObjectUrl: (file: File) => string;
  readonly revokeObjectUrl: (url: string) => void;
};

export type ZhiyuArtifactPut = (input: {
  readonly mimeType: string;
  readonly displayName: string;
  readonly data: Uint8Array;
}) => Promise<{ readonly artifactId: string }>;

export type ZhiyuArtifactReadBytes = (input: {
  readonly artifactId: string;
}) => Promise<{
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}>;

// Runtime turn admission accepts at most one attachment per turn
// (rule.nimi.runtime.agent-participation.r172), so the composer holds one.
export const ZHIYU_MAX_PENDING_ATTACHMENTS = 1;

export function formatZhiyuAttachmentSize(sizeInBytes: number): string {
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

export function isZhiyuAttachmentFileAdmitted(file: Pick<File, 'type'>): boolean {
  return String(file.type || '').toLowerCase().startsWith('image/');
}

export function appendZhiyuPendingAttachment(
  current: readonly ZhiyuPendingAttachment[],
  file: File,
  deps: ZhiyuAttachmentObjectUrlDeps,
): readonly ZhiyuPendingAttachment[] | null {
  if (current.length >= ZHIYU_MAX_PENDING_ATTACHMENTS || !isZhiyuAttachmentFileAdmitted(file)) {
    return null;
  }
  const previewUrl = deps.createObjectUrl(file);
  return [
    ...current,
    {
      file,
      previewUrl,
      name: String(file.name || '').trim() || 'image',
    },
  ];
}

export function removeZhiyuPendingAttachmentAt(
  current: readonly ZhiyuPendingAttachment[],
  index: number,
  revokeObjectUrl: (url: string) => void,
): readonly ZhiyuPendingAttachment[] {
  const target = current[index];
  if (index < 0 || index >= current.length || !target) {
    return current;
  }
  revokeObjectUrl(target.previewUrl);
  return current.filter((_, currentIndex) => currentIndex !== index);
}

export function clearZhiyuPendingAttachments(
  current: readonly ZhiyuPendingAttachment[],
  revokeObjectUrl: (url: string) => void,
): readonly ZhiyuPendingAttachment[] {
  for (const attachment of current) {
    revokeObjectUrl(attachment.previewUrl);
  }
  return [];
}

export async function uploadZhiyuChatAttachment(
  attachment: ZhiyuPendingAttachment,
  putArtifact: ZhiyuArtifactPut,
): Promise<ZhiyuChatAttachmentRef> {
  const bytes = new Uint8Array(await attachment.file.arrayBuffer());
  const uploaded = await putArtifact({
    mimeType: attachment.file.type || 'application/octet-stream',
    displayName: attachment.name,
    data: bytes,
  });
  const artifactId = typeof uploaded?.artifactId === 'string' ? uploaded.artifactId.trim() : '';
  if (!artifactId) {
    throw new Error('Zhiyu artifact upload returned no artifactId.');
  }
  return { artifactId, displayName: attachment.name };
}

export function encodeZhiyuBytesAsDataUrl(mimeType: string, bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export async function resolveZhiyuChatAttachmentMedia(
  artifactId: string,
  fallbackMimeType: string,
  readArtifactBytes: ZhiyuArtifactReadBytes,
): Promise<{ readonly mediaUrl: string; readonly mediaMimeType: string } | null> {
  try {
    const artifact = await readArtifactBytes({ artifactId });
    const mimeType = (typeof artifact?.mimeType === 'string' && artifact.mimeType.trim())
      || fallbackMimeType
      || 'application/octet-stream';
    if (!(artifact?.bytes instanceof Uint8Array) || artifact.bytes.byteLength === 0) {
      return null;
    }
    return {
      mediaUrl: encodeZhiyuBytesAsDataUrl(mimeType, artifact.bytes),
      mediaMimeType: mimeType,
    };
  } catch {
    return null;
  }
}
