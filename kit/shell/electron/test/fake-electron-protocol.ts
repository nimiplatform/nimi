import {
  NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME,
  type NimiElectronShellFileProtocolApi,
} from '../src/main/index.js';

type FakeProtocolHandler = (request: { readonly url: string }) => Promise<Response>;

/**
 * Shared in-memory fake for Electron's `protocol` module. Records the
 * privileged scheme registration and dispatches `request()` calls to the
 * handler installed for the nimi-shell-file scheme, so tests can exercise the
 * `createElectronShellFileProtocolHost` local-asset serving path without a real
 * Electron runtime.
 */
export class FakeElectronProtocol implements NimiElectronShellFileProtocolApi {
  readonly privilegedSchemes: string[] = [];
  readonly handlers = new Map<string, FakeProtocolHandler>();

  registerSchemesAsPrivileged(customSchemes: readonly { readonly scheme: string; readonly privileges: Record<string, boolean> }[]): void {
    for (const entry of customSchemes) {
      this.privilegedSchemes.push(entry.scheme);
    }
  }

  handle(scheme: string, handler: (request: { readonly url: string }) => Promise<{ readonly status?: number }>): void {
    this.handlers.set(scheme, handler as FakeProtocolHandler);
  }

  async request(url: string): Promise<Response> {
    const handler = this.handlers.get(NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME);
    if (!handler) {
      throw new Error('protocol handler is not registered');
    }
    return handler({ url });
  }
}
