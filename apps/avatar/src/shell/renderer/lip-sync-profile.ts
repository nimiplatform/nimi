import type { Profile } from 'wlipsync';
import embeddedProfile from '../../../assets/lip-sync/lip-sync-profile.json';

/**
 * Build-time owned wLipSync profile. A static import is required here so Vite
 * includes the profile in the renderer module graph instead of leaving an
 * Electron runtime JSON-module request with an unsupported MIME type.
 */
export function loadEmbeddedWLipSyncProfile(): Profile {
  return embeddedProfile as unknown as Profile;
}
