import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';
import type { DesktopRendererWorldFollowPort } from '../../renderer/world-follow-port.js';

const STORAGE_PREFIX = 'nimi.world.followed.v1';

function storageKeyFor(accountId: string): string {
  return `${STORAGE_PREFIX}.${accountId}`;
}

function requireStorage(): Storage {
  const storage = resolveBrowserStorage('local');
  if (!storage) throw new Error('DESKTOP_WORLD_FOLLOW_STORAGE_UNAVAILABLE');
  return storage;
}

export function createDesktopProductionWorldFollowPort(): DesktopRendererWorldFollowPort {
  const port: DesktopRendererWorldFollowPort = {
    read(accountId) {
      try {
        const result = readStorageJsonFrom(
          requireStorage(),
          storageKeyFor(accountId),
          (value) => value,
        );
        if (result.state === 'missing') return { state: 'missing' };
        if (result.state === 'ready') return { state: 'ready', value: result.value };
        return { state: 'error', error: result.error || 'world follow projection unreadable' };
      } catch (error) {
        return {
          state: 'error',
          error: error instanceof Error ? error.message : 'world follow projection unavailable',
        };
      }
    },
    write(accountId, worldIds) {
      try {
        const result = writeStorageJsonTo(
          requireStorage(),
          storageKeyFor(accountId),
          [...worldIds],
        );
        return result.state === 'saved'
          ? { state: 'saved' }
          : { state: 'error', error: result.error || 'world follow storage write rejected' };
      } catch (error) {
        return {
          state: 'error',
          error: error instanceof Error ? error.message : 'world follow storage unavailable',
        };
      }
    },
    subscribe(listener) {
      const onStorage = (event: StorageEvent) => {
        const key = event.key;
        if (key && !key.startsWith(STORAGE_PREFIX)) return;
        const accountId = key?.startsWith(`${STORAGE_PREFIX}.`)
          ? key.slice(STORAGE_PREFIX.length + 1) || null
          : null;
        listener(accountId);
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
  };
  return Object.freeze(port);
}
