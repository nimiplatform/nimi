import { describe, expect, it, vi } from 'vitest';

vi.mock('sharp', () => {
  throw new Error('image codec unavailable in this Host');
});

describe('Agent image decoder loading', () => {
  it('keeps ordinary Host imports available and reports the codec failure only for image decoding', async () => {
    const { backgroundMimeForPath, decodeImageDimensions } = await import('../src/main/agent-center-content.js');
    expect(backgroundMimeForPath('image.png')).toBe('image/png');
    expect(await decodeImageDimensions(new Uint8Array(), 'image/png', 1024)).toBeUndefined();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await expect(decodeImageDimensions(png, 'image/png', 1024)).rejects.toMatchObject({
      cause: { message: 'image codec unavailable in this Host' },
    });
  });
});
