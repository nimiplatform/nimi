import {
  parseSharedDesktopAuthSession,
  type SharedDesktopAuthSession,
} from '@nimiplatform/nimi-kit/auth';
import { BridgeError } from './invoke.js';
import { invokeChecked } from './invoke.js';

function parseOptionalSharedDesktopAuthSession(value: unknown): SharedDesktopAuthSession | null {
  if (value == null) {
    return null;
  }
  return parseSharedDesktopAuthSession(value);
}

export async function loadAuthSession(): Promise<SharedDesktopAuthSession | null> {
  try {
    return await invokeChecked('auth_session_load', {}, parseOptionalSharedDesktopAuthSession);
  } catch (error) {
    if (error instanceof BridgeError) {
      return null;
    }
    return null;
  }
}

export async function saveAuthSession(session: SharedDesktopAuthSession): Promise<void> {
  try {
    await invokeChecked('auth_session_save', { payload: session }, () => undefined);
  } catch (error) {
    if (error instanceof BridgeError) {
      return;
    }
    throw error;
  }
}

export async function clearAuthSession(): Promise<void> {
  try {
    await invokeChecked('auth_session_clear', {}, () => undefined);
  } catch (error) {
    if (error instanceof BridgeError) {
      return;
    }
    throw error;
  }
}
