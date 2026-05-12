import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import {
  attachOrthodonticPhoto,
  canonicalizePhotoMime,
  MAX_PHOTO_BASE64_PAYLOAD_BYTES,
  PhotoAngleAlreadyExistsError,
} from './sqlite-bridge-orthodontic-photos.js';

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  // Reset call history AND any leftover `mockResolvedValueOnce` / `mockRejectedValueOnce`
  // queues so each test starts from a known mock state.
  mockedInvoke.mockReset();
});

describe('canonicalizePhotoMime', () => {
  it('maps IANA-conformant values to themselves', () => {
    expect(canonicalizePhotoMime('image/jpeg')).toBe('image/jpeg');
    expect(canonicalizePhotoMime('image/png')).toBe('image/png');
    expect(canonicalizePhotoMime('image/webp')).toBe('image/webp');
  });

  // Wave B audit follow-up (W2): `image/jpg` was a legacy admit that the
  // Rust gate dropped. The renderer must canonicalize it back to the IANA
  // form so users with old file pickers don't bounce off the gate.
  it('rewrites legacy image/jpg to image/jpeg', () => {
    expect(canonicalizePhotoMime('image/jpg')).toBe('image/jpeg');
  });

  it('rewrites image/pjpeg (older Windows) to image/jpeg', () => {
    expect(canonicalizePhotoMime('image/pjpeg')).toBe('image/jpeg');
  });

  it('rewrites image/x-png (IE legacy) to image/png', () => {
    expect(canonicalizePhotoMime('image/x-png')).toBe('image/png');
  });

  it('handles case variants and surrounding whitespace', () => {
    expect(canonicalizePhotoMime('  IMAGE/JPEG  ')).toBe('image/jpeg');
    expect(canonicalizePhotoMime('Image/Png')).toBe('image/png');
  });

  it('strips a charset / boundary parameter before matching', () => {
    expect(canonicalizePhotoMime('image/jpeg; charset=binary')).toBe('image/jpeg');
  });

  it('returns null for HEIC / GIF / BMP and other unadmitted formats', () => {
    expect(canonicalizePhotoMime('image/heic')).toBeNull();
    expect(canonicalizePhotoMime('image/heif')).toBeNull();
    expect(canonicalizePhotoMime('image/gif')).toBeNull();
    expect(canonicalizePhotoMime('image/bmp')).toBeNull();
    expect(canonicalizePhotoMime('image/svg+xml')).toBeNull();
    expect(canonicalizePhotoMime('application/octet-stream')).toBeNull();
  });

  it('returns null for empty, whitespace, null, undefined', () => {
    expect(canonicalizePhotoMime('')).toBeNull();
    expect(canonicalizePhotoMime('   ')).toBeNull();
    expect(canonicalizePhotoMime(null)).toBeNull();
    expect(canonicalizePhotoMime(undefined)).toBeNull();
  });
});

describe('PhotoAngleAlreadyExistsError', () => {
  it('carries sessionId, angle, and the original Rust message', () => {
    const err = new PhotoAngleAlreadyExistsError(
      'sess-1',
      'front',
      'photo for angle "front" already exists on this session; delete the existing attachment first (PO-ORTHO-012)',
    );
    expect(err.name).toBe('PhotoAngleAlreadyExistsError');
    expect(err.sessionId).toBe('sess-1');
    expect(err.angle).toBe('front');
    expect(err.rustMessage).toContain('PO-ORTHO-012');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('attachOrthodonticPhoto', () => {
  const baseParams = {
    attachmentId: 'att-1',
    childId: 'child-1',
    sessionId: 'sess-1',
    fileName: 'front.jpg',
    angle: 'front' as const,
    imageBase64: 'AAAA',
    now: '2026-05-12T00:00:00.000Z',
  };

  it('canonicalizes legacy image/jpg before invoking and forwards the IANA mime', async () => {
    mockedInvoke.mockResolvedValueOnce({
      attachmentId: 'att-1',
      childId: 'child-1',
      sessionId: 'sess-1',
      angle: 'front',
      filePath: '/photos/child-1/sess-1/front.jpg',
      fileName: 'front.jpg',
      mimeType: 'image/jpeg',
      createdAt: baseParams.now,
    });

    await attachOrthodonticPhoto({ ...baseParams, rawMimeType: 'image/jpg' });

    expect(mockedInvoke).toHaveBeenCalledWith(
      'attach_orthodontic_photo',
      expect.objectContaining({ mimeType: 'image/jpeg' }),
    );
  });

  it('fails fast on an unadmitted mime without crossing the bridge', async () => {
    await expect(
      attachOrthodonticPhoto({ ...baseParams, rawMimeType: 'image/heic' }),
    ).rejects.toThrow(/unsupported photo mime/);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('fails fast on payloads larger than the base64 cap', async () => {
    const oversize = 'A'.repeat(MAX_PHOTO_BASE64_PAYLOAD_BYTES + 1);
    await expect(
      attachOrthodonticPhoto({ ...baseParams, rawMimeType: 'image/jpeg', imageBase64: oversize }),
    ).rejects.toThrow(/exceeds the .* base64 cap/);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('upgrades the Rust duplicate-angle error into PhotoAngleAlreadyExistsError', async () => {
    mockedInvoke.mockRejectedValueOnce(
      'photo for angle "front" already exists on this session; delete the existing attachment first (PO-ORTHO-012)',
    );

    const err = await attachOrthodonticPhoto({
      ...baseParams,
      rawMimeType: 'image/jpeg',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PhotoAngleAlreadyExistsError);
    expect(err.sessionId).toBe('sess-1');
    expect(err.angle).toBe('front');
    expect(err.rustMessage).toContain('PO-ORTHO-012');
  });

  it('passes through unrelated Rust errors unmodified', async () => {
    mockedInvoke.mockRejectedValueOnce('photo decode failed: corrupt png');

    const err = await attachOrthodonticPhoto({
      ...baseParams,
      rawMimeType: 'image/png',
    }).catch((e) => e);

    expect(err).not.toBeInstanceOf(PhotoAngleAlreadyExistsError);
    expect(err.message).toContain('photo decode failed');
  });
});
