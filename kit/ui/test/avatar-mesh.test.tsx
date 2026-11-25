import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import {
  AVATAR_MESH_PALETTES,
  Avatar,
  getAvatarMeshInlineStyle,
  getAvatarMonogram,
  renderAvatarMeshPresetFile,
  resolveAvatarMeshPalette,
} from '../src/index.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
});

test('getAvatarMonogram extracts crisp CJK, Latin, multi-word, and handle initials', () => {
  expect(getAvatarMonogram('Halliday')).toBe('H');
  expect(getAvatarMonogram('@halliday')).toBe('H');
  expect(getAvatarMonogram('John Halliday')).toBe('JH');
  expect(getAvatarMonogram('林夏')).toBe('林');
  expect(getAvatarMonogram('   ')).toBe('?');
});

test('resolveAvatarMeshPalette is deterministic per normalized seed and supports explicit overrides', () => {
  const fromPlain = resolveAvatarMeshPalette('Halliday');
  const fromHandle = resolveAvatarMeshPalette('  @halliday  ');
  expect(fromPlain.id).toBe(fromHandle.id);
  expect(AVATAR_MESH_PALETTES).toHaveLength(8);

  const distinctIds = new Set(
    ['Halliday', '林夏', 'Mira', '阿哲'].map((seed) => resolveAvatarMeshPalette(seed).id),
  );
  expect(distinctIds.size).toBeGreaterThanOrEqual(3);

  const explicit = resolveAvatarMeshPalette('Halliday', 'rose');
  expect(explicit.id).toBe('rose');
  expect(getAvatarMeshInlineStyle(explicit, 'light').color).toBe(explicit.light.ink);
  expect(getAvatarMeshInlineStyle(explicit, 'dark').color).toBe(explicit.dark.ink);
});

test('Avatar applies Scheme A soft mesh attribute on neutral fallbacks only and respects stable seed', async () => {
  const expectedPalette = resolveAvatarMeshPalette('user-42').id;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <div>
        <div data-case="a"><Avatar alt="Halliday" seed="user-42" /></div>
        <div data-case="b"><Avatar alt="Renamed User" seed="user-42" /></div>
        <div data-case="explicit"><Avatar alt="林夏" meshPalette="mint" /></div>
        <div data-case="accent"><Avatar alt="Agent" tone="accent" /></div>
      </div>,
    );
  });

  const fallbackA = container.querySelector('[data-case="a"] [data-nimi-avatar-mesh]');
  const fallbackB = container.querySelector('[data-case="b"] [data-nimi-avatar-mesh]');
  const fallbackExplicit = container.querySelector('[data-case="explicit"] [data-nimi-avatar-mesh]');
  const fallbackAccent = container.querySelector('[data-case="accent"] [data-nimi-avatar-mesh]');

  expect(fallbackA?.getAttribute('data-nimi-avatar-mesh')).toBe(expectedPalette);
  expect(fallbackB?.getAttribute('data-nimi-avatar-mesh')).toBe(expectedPalette);
  expect(fallbackA?.textContent).toBe('H');
  expect(fallbackB?.textContent).toBe('RU');

  expect(fallbackExplicit?.getAttribute('data-nimi-avatar-mesh')).toBe('mint');
  expect(fallbackExplicit?.textContent).toBe('林');

  expect(fallbackAccent).toBeNull();
  expect(container.querySelector('[data-case="accent"]')?.textContent).toBe('A');
});

test('renderAvatarMeshPresetFile fails closed without canvas 2D and encodes a PNG when canvas succeeds', async () => {
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    const element = originalCreateElement(tagName);
    if (tagName === 'canvas') {
      Object.defineProperty(element, 'getContext', {
        configurable: true,
        value: () => null,
      });
    }
    return element;
  }) as typeof document.createElement);

  await expect(renderAvatarMeshPresetFile({ name: 'Halliday', paletteId: 'mint' })).rejects.toThrow(
    'AVATAR_PRESET_RENDER_UNAVAILABLE',
  );

  const drawnTexts: string[] = [];
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    const element = originalCreateElement(tagName);
    if (tagName === 'canvas') {
      Object.defineProperty(element, 'getContext', {
        configurable: true,
        value: () => ({
          fillStyle: '',
          font: '',
          textAlign: '',
          textBaseline: '',
          fillRect: vi.fn(),
          createRadialGradient: () => ({ addColorStop: vi.fn() }),
          fillText: (text: string) => { drawnTexts.push(text); },
        }),
      });
      Object.defineProperty(element, 'toBlob', {
        configurable: true,
        value: (callback: (blob: Blob | null) => void) => {
          callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
        },
      });
    }
    return element;
  }) as typeof document.createElement);

  const file = await renderAvatarMeshPresetFile({ name: '林夏', paletteId: 'mint' });
  expect(file.name).toBe('nimi-avatar-mint.png');
  expect(file.type).toBe('image/png');
  expect(file.size).toBe(4);
  expect(drawnTexts).toEqual(['林']);
});
