import {
  type ParsedZhiyuResourcePack,
  type ZhiyuResourcePackResource,
} from './contract.js';
import { materializeZhiyuResourcePackStyle } from './parse.js';

export type ZhiyuResourcePackResourceUrlFactory = Readonly<{
  create(resource: ZhiyuResourcePackResource): string;
  revoke(url: string): void;
}>;

export type ZhiyuResourcePackImageDecoder = (
  resource: ZhiyuResourcePackResource,
) => Promise<void>;

export type ZhiyuResourcePackRender = Readonly<{
  cssText: string;
  pack: ParsedZhiyuResourcePack;
  dispose(): void;
}>;

export async function createZhiyuResourcePackRender(
  pack: ParsedZhiyuResourcePack,
  urlFactory: ZhiyuResourcePackResourceUrlFactory = browserResourceUrlFactory,
  imageDecoder: ZhiyuResourcePackImageDecoder = decodeBrowserImage,
): Promise<ZhiyuResourcePackRender> {
  const urls = new Map<string, string>();
  let disposed = false;
  try {
    for (const resource of pack.resources.values()) {
      await imageDecoder(resource);
      urls.set(resource.path, urlFactory.create(resource));
    }
    const cssText = materializeZhiyuResourcePackStyle(pack, (resource) => {
      const url = urls.get(resource.path);
      if (!url) throw new Error(`Pack resource URL is unavailable: ${resource.path}`);
      return url;
    });
    return Object.freeze({
      cssText,
      pack,
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const url of urls.values()) urlFactory.revoke(url);
        urls.clear();
      },
    });
  } catch (error) {
    for (const url of urls.values()) urlFactory.revoke(url);
    throw error;
  }
}

const browserResourceUrlFactory: ZhiyuResourcePackResourceUrlFactory = Object.freeze({
  create(resource) {
    return URL.createObjectURL(new Blob([resource.bytes.slice()], { type: resource.mimeType }));
  },
  revoke(url) {
    URL.revokeObjectURL(url);
  },
});

async function decodeBrowserImage(resource: ZhiyuResourcePackResource): Promise<void> {
  const blob = new Blob([resource.bytes.slice()], { type: resource.mimeType });
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      assertBoundedImageDimensions(bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    assertBoundedImageDimensions(image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function assertBoundedImageDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0 || width > 8_192 || height > 8_192) {
    throw new Error('Resource Pack image dimensions are invalid or exceed the W1 bound.');
  }
}
