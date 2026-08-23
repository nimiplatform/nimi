import type { AttachmentAdapter } from '../types.js';
import {
  dataPart,
  textPart,
  type NimiMessage,
  type NimiMessagePart,
} from '@nimiplatform/kit/core/sdk-contract';

export type BrowserDataUrlAttachmentKind = 'image' | 'video';

export type BrowserDataUrlAttachment = {
  id: string;
  kind: BrowserDataUrlAttachmentKind;
  name: string;
  dataUrl: string;
  mimeType: string;
};

export type BrowserDataUrlAttachmentAdapterOptions = {
  accept?: readonly string[];
  maxAttachments?: number;
  idPrefix?: string;
  inputFactory?: () => HTMLInputElement;
  idFactory?: () => string;
};

export const DEFAULT_BROWSER_DATA_URL_ATTACHMENT_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
] as const;

let attachmentSequence = 0;

function inferBrowserAttachmentKind(mimeType: string): BrowserDataUrlAttachmentKind | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return null;
}

function createBrowserAttachmentId(prefix: string): string {
  attachmentSequence += 1;
  const randomUUID = globalThis.crypto?.randomUUID?.();
  return randomUUID
    ? `${prefix}:${randomUUID}`
    : `${prefix}:${Date.now().toString(36)}:${attachmentSequence}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name || 'attachment'} as data URL.`));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

export async function browserFilesToDataUrlAttachments(
  files: FileList | readonly File[] | null | undefined,
  options: Pick<BrowserDataUrlAttachmentAdapterOptions, 'idFactory' | 'idPrefix'> = {},
): Promise<BrowserDataUrlAttachment[]> {
  if (!files || files.length === 0) {
    return [];
  }
  const prefix = options.idPrefix?.trim() || 'browser-attachment';
  const out: BrowserDataUrlAttachment[] = [];
  for (const file of Array.from(files)) {
    const kind = inferBrowserAttachmentKind(file.type);
    if (!kind) continue;
    out.push({
      id: options.idFactory?.() ?? createBrowserAttachmentId(prefix),
      kind,
      name: file.name || (kind === 'image' ? 'pasted-image.png' : 'pasted-video.mp4'),
      dataUrl: await readFileAsDataUrl(file),
      mimeType: file.type,
    });
  }
  return out;
}

function openBrowserFilePicker(
  accept: readonly string[],
  options: BrowserDataUrlAttachmentAdapterOptions,
): Promise<BrowserDataUrlAttachment[]> {
  if (typeof document === 'undefined') {
    return Promise.resolve([]);
  }
  return new Promise((resolve) => {
    const input = options.inputFactory?.() ?? document.createElement('input');
    input.type = 'file';
    const maxAttachments = Number.isInteger(options.maxAttachments) && Number(options.maxAttachments) > 0
      ? Number(options.maxAttachments)
      : Number.POSITIVE_INFINITY;
    input.multiple = maxAttachments > 1;
    input.accept = accept.join(',');
    input.style.display = 'none';
    let settled = false;

    const finish = (attachments: BrowserDataUrlAttachment[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(attachments);
    };

    input.addEventListener('change', () => {
      void browserFilesToDataUrlAttachments(input.files, options).then(
        (attachments) => finish(attachments.slice(0, maxAttachments)),
        () => finish([]),
      );
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export function createBrowserDataUrlAttachmentAdapter(
  options: BrowserDataUrlAttachmentAdapterOptions = {},
): AttachmentAdapter<BrowserDataUrlAttachment> {
  const accept = options.accept?.length ? options.accept : DEFAULT_BROWSER_DATA_URL_ATTACHMENT_ACCEPT;
  const maxAttachments = Number.isInteger(options.maxAttachments) && Number(options.maxAttachments) > 0
    ? Number(options.maxAttachments)
    : Number.POSITIVE_INFINITY;
  return {
    openPicker: () => openBrowserFilePicker(accept, options),
    mergeAttachments: (current, incoming) => [...current, ...incoming].slice(-maxAttachments),
    getKey: (attachment) => attachment.id,
    getLabel: (attachment) => attachment.name,
    getSecondaryLabel: (attachment) => attachment.mimeType,
    getPreviewUrl: (attachment) => attachment.dataUrl,
    getKind: (attachment) => attachment.kind,
  };
}

export function browserDataUrlAttachmentsToNimiMessages(
  prompt: string,
  attachments: readonly BrowserDataUrlAttachment[],
): string | NimiMessage[] {
  if (attachments.length === 0) return prompt;
  const parts: NimiMessagePart[] = [
    ...attachments.map((item): NimiMessagePart => dataPart({
      kind: item.kind,
      name: item.name,
      dataUrl: item.dataUrl,
    })),
    textPart(prompt),
  ];
  return [{ role: 'user' as const, content: parts }];
}
