import type {
  NimiRendererThemeControllerV1,
  NimiRendererThemeSnapshotV1,
} from './types.js';

const SCHEMES = new Set(['light', 'dark']);
const DENSITIES = new Set(['compact', 'regular', 'expressive']);

export function assertNimiRendererThemeSnapshot(
  snapshot: NimiRendererThemeSnapshotV1,
): void {
  assertExactOwnKeys(snapshot, ['accentPack', 'density', 'scheme']);
  if (!SCHEMES.has(snapshot.scheme)
    || !DENSITIES.has(snapshot.density)
    || typeof snapshot.accentPack !== 'string'
    || snapshot.accentPack.length === 0) {
    throw new Error('NIMI_RENDERER_HOST_THEME_INVALID');
  }
}

export function createNimiRendererThemeController(
  initial: NimiRendererThemeSnapshotV1,
): NimiRendererThemeControllerV1 {
  assertNimiRendererThemeSnapshot(initial);
  let snapshot = freezeSnapshot(initial);
  const listeners = new Set<() => void>();

  return Object.freeze({
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    setSnapshot(next: NimiRendererThemeSnapshotV1) {
      assertNimiRendererThemeSnapshot(next);
      if (snapshot.scheme === next.scheme
        && snapshot.accentPack === next.accentPack
        && snapshot.density === next.density) {
        return;
      }
      snapshot = freezeSnapshot(next);
      for (const listener of [...listeners]) listener();
    },
  });
}

function freezeSnapshot(
  snapshot: NimiRendererThemeSnapshotV1,
): NimiRendererThemeSnapshotV1 {
  return Object.freeze({
    scheme: snapshot.scheme,
    accentPack: snapshot.accentPack,
    density: snapshot.density,
  });
}

function assertExactOwnKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new Error('NIMI_RENDERER_HOST_THEME_KEYS_INVALID');
  }
}
