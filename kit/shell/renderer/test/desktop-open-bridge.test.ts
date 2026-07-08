import { afterEach, describe, expect, it, vi } from 'vitest';

import { openDesktopIntent } from '../src/bridge/desktop-open.js';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

describe('renderer desktop-open bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends only renderer-owned payload fields to the standard shell host', async () => {
    const invokes: unknown[] = [];
    vi.stubGlobal('__NIMI_ELECTRON_RUNTIME__', {
      invoke: async (command: string, payload: unknown) => {
        invokes.push({ command, payload });
        return {
          status: 'accepted',
          confirmation: 'desktop-accepted',
          bridgeId: 'desktop-open-20260708-bridge',
          requestId: 'desktop-open-20260708-renderer',
          appliedTarget: 'open-apps',
        };
      },
    });

    await expect(openDesktopIntent({
      requestId: 'desktop-open-20260708-renderer',
      intent: { kind: 'open-apps' },
    })).resolves.toEqual({
      status: 'accepted',
      confirmation: 'desktop-accepted',
      bridgeId: 'desktop-open-20260708-bridge',
      requestId: 'desktop-open-20260708-renderer',
      appliedTarget: 'open-apps',
    });

    expect(invokes).toEqual([{
      command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
      payload: {
        payload: {
          requestId: 'desktop-open-20260708-renderer',
          intent: { kind: 'open-apps' },
        },
      },
    }]);
  });

  it('fails closed before host invoke when payload attempts host metadata custody', async () => {
    const invoke = vi.fn();
    vi.stubGlobal('__NIMI_ELECTRON_RUNTIME__', { invoke });

    await expect(openDesktopIntent({
      sourceHost: 'electron-standard-shell',
      intent: { kind: 'open-apps' },
    })).rejects.toThrow(/unsupported field/u);
    expect(invoke).not.toHaveBeenCalled();
  });
});
