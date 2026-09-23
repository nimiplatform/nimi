/**
 * Conversation image attachments cross the Runtime attachment contract, which
 * caps a single upload at 4 MiB of raw bytes and admits only PNG/JPEG/WebP/GIF
 * (see kit/shell/protected-local/proto/runtime/v1/artifact_service.proto).
 * The renderer prepares an image to fit that contract before it leaves the
 * process: an in-limit supported file is sent untouched, and anything else is
 * re-encoded to WebP on a downscale/quality ladder until it fits.
 */

export const CONVERSATION_IMAGE_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;

export const CONVERSATION_IMAGE_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type ConversationImageAttachmentMimeType = (typeof CONVERSATION_IMAGE_ATTACHMENT_MIME_TYPES)[number];

export type ConversationImageAttachmentFailureReason = 'unsupported-format' | 'too-large';

export class ConversationImageAttachmentError extends Error {
  readonly reason: ConversationImageAttachmentFailureReason;

  constructor(reason: ConversationImageAttachmentFailureReason, message: string) {
    super(message);
    this.name = 'ConversationImageAttachmentError';
    this.reason = reason;
  }
}

export type PreparedConversationImageAttachment = {
  readonly bytes: Uint8Array;
  readonly mimeType: ConversationImageAttachmentMimeType;
  /** True when the bytes differ from the picked file (re-encoded or downscaled). */
  readonly reencoded: boolean;
};

export type ConversationImageReencodeRequest = {
  readonly file: File;
  readonly width: number;
  readonly height: number;
  readonly mimeType: 'image/webp';
  readonly quality: number;
};

/**
 * Host-provided image decode/encode. The browser implementation lives in
 * `createBrowserConversationImageReencoder`; tests inject a fake.
 */
export type ConversationImageReencoder = {
  /** Natural pixel size of the decoded image, or null when it cannot be decoded. */
  readonly measure: (file: File) => Promise<{ readonly width: number; readonly height: number } | null>;
  /** Encoded bytes at the requested size/quality, or null when encoding fails. */
  readonly encode: (request: ConversationImageReencodeRequest) => Promise<Uint8Array | null>;
};

const REENCODE_SCALE_LADDER = [1, 0.85, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2] as const;
const REENCODE_QUALITY_LADDER = [0.85, 0.7] as const;

export function isConversationImageAttachmentMimeType(
  value: string,
): value is ConversationImageAttachmentMimeType {
  return (CONVERSATION_IMAGE_ATTACHMENT_MIME_TYPES as readonly string[]).includes(value);
}

export async function prepareConversationImageAttachment(
  file: File,
  options: {
    readonly reencoder: ConversationImageReencoder;
    readonly maxBytes?: number;
  },
): Promise<PreparedConversationImageAttachment> {
  const maxBytes = options.maxBytes ?? CONVERSATION_IMAGE_ATTACHMENT_MAX_BYTES;
  const originalMimeType = String(file.type || '').trim().toLowerCase();
  const originalBytes = new Uint8Array(await file.arrayBuffer());

  if (isConversationImageAttachmentMimeType(originalMimeType)
    && originalBytes.byteLength > 0
    && originalBytes.byteLength <= maxBytes) {
    return { bytes: originalBytes, mimeType: originalMimeType, reencoded: false };
  }

  const size = await options.reencoder.measure(file);
  if (!size || !(size.width > 0) || !(size.height > 0)) {
    throw new ConversationImageAttachmentError(
      'unsupported-format',
      `Conversation image attachment could not be decoded (${originalMimeType || 'unknown type'}).`,
    );
  }

  for (const scale of REENCODE_SCALE_LADDER) {
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    for (const quality of REENCODE_QUALITY_LADDER) {
      const encoded = await options.reencoder.encode({ file, width, height, mimeType: 'image/webp', quality });
      if (encoded && encoded.byteLength > 0 && encoded.byteLength <= maxBytes) {
        return { bytes: encoded, mimeType: 'image/webp', reencoded: true };
      }
    }
  }

  throw new ConversationImageAttachmentError(
    'too-large',
    `Conversation image attachment still exceeds ${maxBytes} bytes after re-encoding.`,
  );
}

type EncodeCanvas = {
  readonly getContext: (id: '2d') => { drawImage: (image: ImageBitmap, x: number, y: number, w: number, h: number) => void } | null;
  readonly toBlob: (type: string, quality: number) => Promise<Blob | null>;
};

function createEncodeCanvas(width: number, height: number): EncodeCanvas | null {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    return {
      getContext: (id) => canvas.getContext(id),
      toBlob: (type, quality) => canvas.convertToBlob({ type, quality }),
    };
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return {
    getContext: (id) => canvas.getContext(id),
    toBlob: (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality)),
  };
}

/** Browser/Electron renderer implementation backed by ImageBitmap + canvas. */
export function createBrowserConversationImageReencoder(): ConversationImageReencoder {
  const decode = async (file: File): Promise<ImageBitmap | null> => {
    if (typeof createImageBitmap !== 'function') return null;
    try {
      return await createImageBitmap(file);
    } catch {
      return null;
    }
  };
  return {
    measure: async (file) => {
      const bitmap = await decode(file);
      if (!bitmap) return null;
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    },
    encode: async (request) => {
      const bitmap = await decode(request.file);
      if (!bitmap) return null;
      try {
        const canvas = createEncodeCanvas(request.width, request.height);
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return null;
        context.drawImage(bitmap, 0, 0, request.width, request.height);
        const blob = await canvas.toBlob(request.mimeType, request.quality);
        if (!blob || blob.type !== request.mimeType) return null;
        return new Uint8Array(await blob.arrayBuffer());
      } catch {
        return null;
      } finally {
        bitmap.close();
      }
    },
  };
}
