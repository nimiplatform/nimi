// @vitest-environment jsdom
import { File } from 'node:buffer';
import { webcrypto, createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createAgentCenterBrowserHostMechanics } from '../src/browser-resource-pack-picker.js';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('browser selection returns the chosen bytes and digest without native or Agent identity', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const mechanics = createAgentCenterBrowserHostMechanics({ document, maxResourcePackBytes: 64 });
  const result = mechanics.selectResourcePack!();
  const input = document.querySelector('input[type=file]')!;
  const file = new File([Uint8Array.of(1, 2, 3)], 'test.nimipack');
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change'));
  expect(await result).toEqual({ role: 'resource-pack', mediaType: 'application/vnd.nimi.resource-pack+zip',
    fileName: 'test.nimipack', content: Uint8Array.of(1, 2, 3), sha256: createHash('sha256').update(Uint8Array.of(1, 2, 3)).digest('hex') });
  expect(document.querySelector('input')).toBeNull();
  expect(mechanics.selectAvatar).toBeUndefined();
});

it('cancel returns no selection and an oversized file is refused before reading', async () => {
  const mechanics = createAgentCenterBrowserHostMechanics({ document, maxResourcePackBytes: 2 });
  const canceled = mechanics.selectResourcePack!();
  document.querySelector('input')!.dispatchEvent(new Event('cancel'));
  expect(await canceled).toBeNull();
  const result = mechanics.selectResourcePack!();
  const read = vi.fn();
  const input = document.querySelector('input')!;
  Object.defineProperty(input, 'files', { value: [{ size: 3, name: 'too-large.nimipack', arrayBuffer: read }] });
  input.dispatchEvent(new Event('change'));
  await expect(result).rejects.toThrow('size limit');
  expect(read).not.toHaveBeenCalled();
});
