import { isIP } from 'node:net';

// @nimi-authority: definition.nimi.platform.app-ecosystem.managed-web-desktop-carrier
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a

const MAX_EXTERNAL_URL_BYTES = 2048;
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/u;
const RESERVED_EXTERNAL_HOST_SUFFIXES = Object.freeze([
  'localhost',
  'local',
  'internal',
  'home.arpa',
  'invalid',
  'test',
]);

export const ALLOWED_EXTERNAL_OPEN_DISPOSITIONS = Object.freeze([
  'foreground-tab',
  'new-window',
  'background-tab',
] as const);

export type AllowedExternalOpenDisposition = typeof ALLOWED_EXTERNAL_OPEN_DISPOSITIONS[number];

/**
 * Validates an HTTPS initial URL for OS browser handoff from the managed-web
 * carrier. Rejects non-HTTPS schemes, credentials, control characters,
 * oversized URLs, all raw IPv4/IPv6 literals, single-label hosts, and reserved
 * local/test domain suffixes.
 */
export function parseManagedWebExternalUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.trim() !== raw) {
    return undefined;
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_EXTERNAL_URL_BYTES || CONTROL_CHAR_PATTERN.test(raw)) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return undefined;
  }
  if (Buffer.byteLength(parsed.href, 'utf8') > MAX_EXTERNAL_URL_BYTES) {
    return undefined;
  }
  const rawHost = parsed.hostname.toLowerCase();
  if (!rawHost) {
    return undefined;
  }
  const unbracketed = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost;
  if (isIP(unbracketed) !== 0) {
    return undefined;
  }
  const host = rawHost.endsWith('.') ? rawHost.slice(0, -1) : rawHost;
  if (
    !host
    || isIP(host) !== 0
    || host.startsWith('.')
    || host.endsWith('.')
    || host.includes('..')
    || !host.includes('.')
  ) {
    return undefined;
  }
  if (RESERVED_EXTERNAL_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return undefined;
  }
  return parsed.href;
}

export type RollingWindowRateLimiter = {
  tryAcquire(): boolean;
};

export function createRollingWindowRateLimiter(options?: {
  readonly maxEvents?: number;
  readonly windowMs?: number;
  readonly minIntervalMs?: number;
  readonly now?: () => number;
}): RollingWindowRateLimiter {
  const maxEvents = options?.maxEvents ?? 3;
  const windowMs = options?.windowMs ?? 10_000;
  const minIntervalMs = options?.minIntervalMs ?? 500;
  const now = options?.now ?? Date.now;
  let timestamps: number[] = [];

  return {
    tryAcquire(): boolean {
      const ts = now();
      timestamps = timestamps.filter((entry) => ts - entry < windowMs && entry <= ts);
      if (timestamps.length >= maxEvents) {
        return false;
      }
      const last = timestamps[timestamps.length - 1];
      if (last !== undefined && ts - last < minIntervalMs) {
        return false;
      }
      timestamps.push(ts);
      return true;
    },
  };
}

export function evaluateManagedWebExternalOpenRequest(input: {
  readonly url: unknown;
  readonly disposition: unknown;
  readonly hasPostBody: boolean;
  readonly windowDestroyed: boolean;
  readonly windowVisible: boolean;
  readonly windowFocused: boolean;
  readonly rateLimiter: RollingWindowRateLimiter;
}): string | undefined {
  if (input.windowDestroyed || !input.windowVisible || !input.windowFocused || input.hasPostBody) {
    return undefined;
  }
  if (
    typeof input.disposition !== 'string'
    || !(ALLOWED_EXTERNAL_OPEN_DISPOSITIONS as readonly string[]).includes(input.disposition)
  ) {
    return undefined;
  }
  const safeUrl = parseManagedWebExternalUrl(input.url);
  if (!safeUrl) {
    return undefined;
  }
  if (!input.rateLimiter.tryAcquire()) {
    return undefined;
  }
  return safeUrl;
}

export type ManagedWebUnloadDialogCopy = {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly [string, string];
  readonly defaultId: 0;
  readonly cancelId: 0;
  readonly noLink: true;
};

export function buildManagedWebUnloadDialogCopy(
  displayName: string,
  locale: string,
): ManagedWebUnloadDialogCopy {
  const chinese = locale.toLowerCase().startsWith('zh');
  return {
    title: displayName,
    message: chinese ? '要放弃未保存的修改并离开吗？' : 'Discard unsaved changes and leave?',
    detail: chinese
      ? '当前窗口有未保存的修改或正在进行的操作。选择“取消”可返回保存，选择“放弃并离开”将关闭窗口并丢弃未保存的改动。'
      : 'This window has unsaved changes or work in progress. Cancel to return and save, or discard unsaved edits and leave.',
    buttons: chinese ? ['取消', '放弃并离开'] : ['Cancel', 'Discard and leave'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

export type ManagedWebLifecycleControllerDeps<Win extends object> = {
  readonly platform: NodeJS.Platform;
  readonly now?: () => number;
  readonly cancelCooldownMs?: number;
  readonly getWindows: () => readonly Win[];
  readonly isWindowDestroyed: (win: Win) => boolean;
  readonly destroyWindow: (win: Win) => void;
  readonly createWindow: (onConstructed: () => void) => Promise<void>;
  readonly confirmUnload: (win: Win, signal: AbortSignal) => Promise<boolean>;
  readonly quitApp: () => void;
  readonly unregisterBridge: () => void;
  readonly disposeChromeHost: () => void;
  readonly onResetError?: (error: unknown) => void;
};

export type ManagedWebLifecycleController<Win extends object> = {
  markWindowCreated(): void;
  markWindowClose(win: Win): void;
  markWindowClosed(win: Win): void;
  markBeforeQuit(): void;
  markWillQuit(): void;
  handleSigterm(): void;
  handleWillPreventUnload(win: Win, preventDefault: () => void): void;
  handleSessionInvalidated(): void;
  shouldQuitOnWindowAllClosed(): boolean;
  shouldCreateOnActivate(): boolean;
  isQuitting(): boolean;
};

type ActiveDialogEntry = {
  readonly abort: AbortController;
  readonly token: symbol;
  quitIntent: boolean;
};

export function createManagedWebLifecycleController<Win extends object>(
  deps: ManagedWebLifecycleControllerDeps<Win>,
): ManagedWebLifecycleController<Win> {
  const now = deps.now ?? Date.now;
  const cancelCooldownMs = deps.cancelCooldownMs ?? 300;
  const closingWindows = new WeakSet<Win>();
  const bypassUnloadWindows = new WeakSet<Win>();
  const activeDialogs = new Map<Win, ActiveDialogEntry>();

  let quitting = false;
  let forceQuitting = false;
  let pendingQuitIntent = false;
  let resettingRenderer = false;
  let scopeResetInFlight = false;
  let pendingSessionReset = false;
  let lastCancelAt = Number.NEGATIVE_INFINITY;

  const abortDialogFor = (win: Win): void => {
    const entry = activeDialogs.get(win);
    if (!entry) return;
    activeDialogs.delete(win);
    entry.abort.abort();
  };

  const abortAllDialogs = (): void => {
    for (const [win, entry] of [...activeDialogs.entries()]) {
      activeDialogs.delete(win);
      entry.abort.abort();
    }
  };

  const destroyAllLiveWindows = (): void => {
    for (const win of [...deps.getWindows()]) {
      closingWindows.delete(win);
      abortDialogFor(win);
      if (!deps.isWindowDestroyed(win)) {
        deps.destroyWindow(win);
      }
    }
  };

  const runResetCycle = (): void => {
    if (quitting || forceQuitting) {
      return;
    }
    scopeResetInFlight = true;
    resettingRenderer = true;
    let clearedResetting = false;
    const clearResetting = (): void => {
      if (!clearedResetting) {
        clearedResetting = true;
        resettingRenderer = false;
      }
    };
    try {
      destroyAllLiveWindows();
    } catch (error) {
      clearResetting();
      scopeResetInFlight = false;
      deps.onResetError?.(error);
      return;
    }
    void deps.createWindow(clearResetting)
      .catch((error) => {
        deps.onResetError?.(error);
      })
      .finally(() => {
        clearResetting();
        scopeResetInFlight = false;
        if (pendingSessionReset && !quitting && !forceQuitting) {
          pendingSessionReset = false;
          runResetCycle();
        }
      });
  };

  return {
    markWindowCreated(): void {
      pendingQuitIntent = false;
    },

    markWindowClose(win: Win): void {
      if (quitting || forceQuitting) return;
      closingWindows.add(win);
    },

    markWindowClosed(win: Win): void {
      closingWindows.delete(win);
      bypassUnloadWindows.delete(win);
      abortDialogFor(win);
    },

    markBeforeQuit(): void {
      if (quitting || forceQuitting) return;
      if (activeDialogs.size > 0) {
        for (const entry of activeDialogs.values()) {
          entry.quitIntent = true;
        }
        pendingQuitIntent = false;
        return;
      }
      pendingQuitIntent = true;
    },

    markWillQuit(): void {
      if (quitting) return;
      quitting = true;
      pendingQuitIntent = false;
      pendingSessionReset = false;
      abortAllDialogs();
      deps.unregisterBridge();
      deps.disposeChromeHost();
    },

    handleSigterm(): void {
      if (forceQuitting) return;
      quitting = true;
      forceQuitting = true;
      pendingQuitIntent = false;
      pendingSessionReset = false;
      abortAllDialogs();
      destroyAllLiveWindows();
      deps.quitApp();
    },

    handleWillPreventUnload(win: Win, preventDefault: () => void): void {
      if (forceQuitting || quitting || bypassUnloadWindows.has(win)) {
        closingWindows.delete(win);
        pendingQuitIntent = false;
        preventDefault();
        return;
      }
      // Consume intent immediately on every entry so cooldown/duplicate early
      // returns never leak stale close/quit flags onto later reloads.
      const hadClose = closingWindows.delete(win);
      const hadQuit = pendingQuitIntent;
      pendingQuitIntent = false;

      const existing = activeDialogs.get(win);
      if (existing) {
        if (hadQuit) {
          existing.quitIntent = true;
        }
        return;
      }
      if (!hadClose && !hadQuit) {
        return;
      }
      if (now() - lastCancelAt < cancelCooldownMs) {
        return;
      }

      const abort = new AbortController();
      const token = Symbol('managed-web-unload');
      const entry: ActiveDialogEntry = { abort, token, quitIntent: hadQuit };
      activeDialogs.set(win, entry);

      void deps.confirmUnload(win, abort.signal)
        .then((discard) => {
          const current = activeDialogs.get(win);
          if (!current || current.token !== token) {
            return;
          }
          const shouldQuit = current.quitIntent || pendingQuitIntent;
          pendingQuitIntent = false;
          activeDialogs.delete(win);
          closingWindows.delete(win);
          if (quitting || forceQuitting || deps.isWindowDestroyed(win)) {
            return;
          }
          if (discard) {
            bypassUnloadWindows.add(win);
            if (shouldQuit) {
              forceQuitting = true;
              deps.quitApp();
            } else {
              deps.destroyWindow(win);
            }
          } else {
            lastCancelAt = now();
          }
        })
        .catch(() => {
          const current = activeDialogs.get(win);
          if (current && current.token === token) {
            activeDialogs.delete(win);
            closingWindows.delete(win);
            pendingQuitIntent = false;
          }
        });
    },

    handleSessionInvalidated(): void {
      if (quitting || forceQuitting) {
        return;
      }
      pendingQuitIntent = false;
      if (scopeResetInFlight) {
        // Immediately revoke any in-flight replacement window and coalesce only
        // the next window creation.
        resettingRenderer = true;
        try {
          destroyAllLiveWindows();
        } finally {
          resettingRenderer = false;
        }
        pendingSessionReset = true;
        return;
      }
      if (deps.getWindows().length === 0) {
        return;
      }
      runResetCycle();
    },

    shouldQuitOnWindowAllClosed(): boolean {
      return deps.platform !== 'darwin' && !resettingRenderer;
    },

    shouldCreateOnActivate(): boolean {
      return !quitting && !forceQuitting && !resettingRenderer && !scopeResetInFlight;
    },

    isQuitting(): boolean {
      return quitting || forceQuitting;
    },
  };
}
