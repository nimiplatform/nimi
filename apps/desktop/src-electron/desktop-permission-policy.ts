import type { Session } from 'electron';

type PermissionSession = Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>;

// Home and Avatar ask Chromium for two things only: the microphone for voice
// input and writing to the clipboard. Any other permission, and any request
// from a page that is not Nimi's own, is refused; Electron would otherwise
// grant every request.
export function installDesktopPermissionPolicy(session: PermissionSession, trustedOrigins: ReadonlySet<string>): void {
  const trusted = (url: string | undefined): boolean => {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const origin = parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
      return trustedOrigins.has(origin);
    } catch {
      return false;
    }
  };
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = details.requestingUrl || webContents?.getURL();
    if (!trusted(url)) {
      callback(false);
      return;
    }
    if (permission === 'media') {
      const mediaTypes = (details as { mediaTypes?: readonly string[] }).mediaTypes ?? [];
      callback(mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio'));
      return;
    }
    callback(permission === 'clipboard-sanitized-write');
  });
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    if (!trusted(requestingOrigin)) return false;
    if (permission === 'media') return (details as { mediaType?: string }).mediaType === 'audio';
    return permission === 'clipboard-sanitized-write';
  });
}
