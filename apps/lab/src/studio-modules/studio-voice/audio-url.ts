// Shared by request dispatch and saved-request restoration.
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function audioMimeTypeFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const extension = url.pathname.split('.').pop()?.toLowerCase();
    if (extension === 'wav') return 'audio/wav';
    if (extension === 'mp3') return 'audio/mpeg';
    if (extension === 'm4a') return 'audio/mp4';
    if (extension === 'ogg') return 'audio/ogg';
    if (extension === 'webm') return 'audio/webm';
    if (extension === 'flac') return 'audio/flac';
    return null;
  } catch {
    return null;
  }
}
