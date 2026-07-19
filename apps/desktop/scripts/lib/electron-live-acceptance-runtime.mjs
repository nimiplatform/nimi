/* global document, HTMLElement, location */
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

export const OFFLINE_STRIP_TEST_ID = 'offline-strip';

export async function invokeShell(page, commandKey, payload) {
  const outcome = await page.evaluate(async ({ command, commandPayload }) => {
    try {
      return {
        ok: true,
        value: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, commandPayload),
      };
    } catch (error) {
      const record = error && typeof error === 'object' ? error : {};
      return {
        ok: false,
        error: {
          name: typeof record.name === 'string' ? record.name : '',
          message: typeof record.message === 'string' ? record.message : String(error),
          code: typeof record.code === 'string' ? record.code : '',
          reasonCode: typeof record.reasonCode === 'string' ? record.reasonCode : '',
          actionHint: typeof record.actionHint === 'string' ? record.actionHint : '',
        },
      };
    }
  }, {
    command: NIMI_STANDARD_SHELL_COMMANDS[commandKey],
    commandPayload: payload,
  });
  if (!outcome.ok) {
    throw new Error(`Electron shell command ${commandKey} failed: ${JSON.stringify(outcome.error)}`);
  }
  return outcome.value;
}

export async function invokeOptionalCommand(page, command, payload) {
  return await page.evaluate(async ({ commandName, commandPayload }) => {
    try {
      return {
        ok: true,
        value: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commandName, commandPayload),
      };
    } catch (error) {
      const record = error && typeof error === 'object' ? error : {};
      return {
        ok: false,
        error: {
          message: typeof record.message === 'string' ? record.message : String(error),
          reasonCode: typeof record.reasonCode === 'string' ? record.reasonCode : '',
        },
      };
    }
  }, { commandName: command, commandPayload: payload });
}

export async function retryUntil(operation, accepted, attempts, delayMs) {
  let lastError;
  let lastValue;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      lastValue = await operation();
      if (accepted(lastValue)) return lastValue;
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (lastError) throw lastError;
  throw new Error(`acceptance condition did not converge: ${JSON.stringify(lastValue)}`);
}

export function summarizeAuthorizations(outcome) {
  if (!outcome.ok || !Array.isArray(outcome.value)) {
    return { available: false, count: 0, reasonCode: outcome.error?.reasonCode || '' };
  }
  return {
    available: true,
    count: outcome.value.length,
    activeCount: outcome.value.filter((row) => row?.state === 'active').length,
    apps: [...new Set(outcome.value.map((row) => normalizeText(row?.appId)).filter(Boolean))].sort(),
  };
}

export async function captureAccountSessionSnapshot(page) {
  return await page.evaluate(async () => {
    const hook = globalThis.window.__NIMI_ELECTRON_RUNTIME__;
    const pending = [];
    const unsubscribe = hook.listen('runtime_account_session_events', ({ payload }) => {
      pending.push(payload);
    });
    let streamId = '';
    try {
      const status = await hook.invoke('runtime_account_session_status', {});
      const opened = await hook.invoke('runtime_account_session_events_open', {
        afterSequence: status.sequence,
      });
      streamId = opened.streamId;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const event = pending.find((candidate) => candidate?.streamId === streamId);
        if (event) return { status, event };
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('timed out waiting for protected account session snapshot');
    } finally {
      if (streamId) {
        await hook.invoke('runtime_account_session_events_close', { streamId }).catch(() => undefined);
      }
      unsubscribe();
    }
  });
}

export async function invokeRealmProbe(page, timeoutMs = 10_000) {
  return await page.evaluate(async (probeTimeoutMs) => {
    try {
      return {
        ok: true,
        value: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(
          'runtime_account_invoke_realm_unary',
          {
            payload: {
              methodId: 'WorldCoreController_listPersonaCharacters',
              requestJson: '{}',
              timeoutMs: probeTimeoutMs,
              idempotencyKey: `desktop-live-realm-probe-${Date.now()}`,
            },
          },
        ),
      };
    } catch (error) {
      const record = error && typeof error === 'object' ? error : {};
      return {
        ok: false,
        error: {
          name: typeof record.name === 'string' ? record.name : '',
          message: typeof record.message === 'string' ? record.message : String(error),
          code: typeof record.code === 'string' ? record.code : '',
          reasonCode: typeof record.reasonCode === 'string' || typeof record.reasonCode === 'number'
            ? record.reasonCode
            : '',
          actionHint: typeof record.actionHint === 'string' ? record.actionHint : '',
        },
      };
    }
  }, timeoutMs);
}

export async function captureRendererDiagnostics(page) {
  return await page.evaluate(() => {
    const visibleTestIds = [...document.querySelectorAll('[data-testid]')]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
      .map((element) => element.getAttribute('data-testid'))
      .filter(Boolean)
      .slice(0, 100);
    const offlineStrip = document.querySelector('[data-testid="offline-strip"]');
    return {
      url: location.href,
      readyState: document.readyState,
      bodyText: document.body?.innerText?.slice(0, 8_000) || '',
      visibleTestIds,
      offlineStripText: offlineStrip?.textContent?.trim() || '',
      productState: document.querySelector('[data-product-state]')?.getAttribute('data-product-state') || null,
    };
  });
}

export function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
