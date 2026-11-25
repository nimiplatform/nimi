export const NIMI_REPOSITORY_URL = 'https://github.com/nimiplatform/nimi';
export const NIMI_RELEASES_URL = `${NIMI_REPOSITORY_URL}/releases`;
export const NIMI_PUBLIC_BETA_VERSION = '0.2.4';
export const NIMI_PUBLIC_BETA_ASSET_URL = `${NIMI_RELEASES_URL}/download/${encodeURIComponent(`nimi/v${NIMI_PUBLIC_BETA_VERSION}`)}`;
export const NIMI_WINDOWS_ASSET = `Nimi-${NIMI_PUBLIC_BETA_VERSION}-windows-amd64.exe`;
export const NIMI_MACOS_ASSET = `Nimi-${NIMI_PUBLIC_BETA_VERSION}-macos-arm64.pkg`;
export const NIMI_WINDOWS_DOWNLOAD_URL = `${NIMI_PUBLIC_BETA_ASSET_URL}/${NIMI_WINDOWS_ASSET}`;
export const NIMI_MACOS_DOWNLOAD_URL = `${NIMI_PUBLIC_BETA_ASSET_URL}/${NIMI_MACOS_ASSET}`;

export type DetectedPlatform = 'windows' | 'macos' | 'mobile' | 'linux' | null;

export function detectVisitorPlatform(userAgent?: string): DetectedPlatform {
  const raw = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const ua = raw.toLowerCase();
  if (!ua) return null;
  if (/iphone|ipad|ipod|android/.test(ua)) return 'mobile';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return null;
}
