const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function toOrigin(input: string): string {
  const normalized = String(input || '').trim();
  if (!normalized) {
    return '';
  }

  try {
    return new URL(normalized).origin;
  } catch {
    return '';
  }
}

export function resolveRealtimeUrl(input: {
  realmBaseUrl?: string | null;
  realtimeUrl?: string | null;
}): string {
  const explicitRealtimeOrigin = toOrigin(String(input.realtimeUrl || ''));
  if (explicitRealtimeOrigin) {
    return explicitRealtimeOrigin;
  }

  const apiOrigin = toOrigin(String(input.realmBaseUrl || ''));
  if (!apiOrigin) {
    return '';
  }

  try {
    const parsed = new URL(apiOrigin);
    const hostname = parsed.hostname.toLowerCase();
    if (LOCAL_HOSTS.has(hostname) && parsed.port === '3002') {
      parsed.port = '3003';
      return parsed.origin;
    }
    return parsed.origin;
  } catch {
    return '';
  }
}

