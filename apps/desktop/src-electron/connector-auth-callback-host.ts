import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type {
  NimiConnectorAuthAcquisitionCallback,
  NimiConnectorAuthAcquisitionCallbackRequest,
} from '@nimiplatform/sdk/runtime/host';

const CALLBACK_QUERY_LIMIT = 16 * 1024;
const HOST_ID_FILE = 'connector-auth-host-id';
const HOST_ID_PATTERN = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const COMPLETION_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Nimi</title></head>
<body style="font-family:system-ui,sans-serif;margin:3rem;color:#1f2328">
<h1 style="font-size:1.25rem">You can return to Nimi</h1>
<p>Nimi received the sign-in response. You can close this tab.</p></body></html>`;

function writePage(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

// Starts the loopback listener before the browser opens. It binds only the
// requested loopback address on a fresh port and accepts one GET on the exact
// callback path; the authorization result is validated by the SDK host.
export async function startDesktopConnectorAuthCallback(
  request: NimiConnectorAuthAcquisitionCallbackRequest,
  signal?: AbortSignal,
): Promise<NimiConnectorAuthAcquisitionCallback> {
  if (request.host !== '127.0.0.1' || !/^\/[A-Za-z0-9/_-]+$/u.test(request.path)) {
    throw new Error('Connector authorization callback must use the admitted loopback host and path');
  }
  if (signal?.aborted) throw signal.reason;
  let settled = false;
  let resolveCallback: (params: Record<string, string>) => void = () => undefined;
  const callback = new Promise<Record<string, string>>((resolve) => {
    resolveCallback = resolve;
  });
  const server = createServer((incoming: IncomingMessage, response: ServerResponse) => {
    const target = incoming.url ?? '';
    const queryIndex = target.indexOf('?');
    const pathname = queryIndex >= 0 ? target.slice(0, queryIndex) : target;
    if (incoming.method !== 'GET' || pathname !== request.path || target.length > CALLBACK_QUERY_LIMIT) {
      writePage(response, 404, '<!doctype html><title>Not found</title>');
      return;
    }
    if (settled) {
      writePage(response, 410, '<!doctype html><title>Expired</title>');
      return;
    }
    const params: Record<string, string> = {};
    const search = new URLSearchParams(queryIndex >= 0 ? target.slice(queryIndex + 1) : '');
    for (const [key, value] of search) {
      // A repeated parameter is ambiguous; keep none of its values.
      params[key] = Object.hasOwn(params, key) ? '' : value;
    }
    settled = true;
    writePage(response, 200, COMPLETION_PAGE);
    resolveCallback(params);
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, request.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  let closing: Promise<void> | undefined;
  const close = () => {
    signal?.removeEventListener('abort', onAbort);
    closing ??= new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    return closing;
  };
  // The acquisition owns this listener: canceling it closes the listener even
  // when cancellation raced with startup, and a canceled startup never returns
  // a live listener.
  function onAbort(): void {
    void close();
  }
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    await close();
    throw signal.reason;
  }
  return {
    redirectUri: `http://${request.host}:${address.port}${request.path}`,
    waitForCallback(waitSignal: AbortSignal) {
      if (waitSignal.aborted) return Promise.reject(waitSignal.reason);
      return new Promise<Record<string, string>>((resolve, reject) => {
        const onAbort = () => reject(waitSignal.reason);
        waitSignal.addEventListener('abort', onAbort, { once: true });
        void callback.then((params) => {
          waitSignal.removeEventListener('abort', onAbort);
          resolve(params);
        });
      });
    },
    close,
  };
}

// Returns this Desktop host's stable opaque ext_agent_host_id. It identifies
// the installation only; it is neither a token nor a user identifier.
export async function readOrCreateDesktopConnectorAuthHostId(userDataDirectory: string): Promise<string> {
  const file = path.join(userDataDirectory, HOST_ID_FILE);
  try {
    const existing = (await fs.readFile(file, 'utf8')).trim();
    if (HOST_ID_PATTERN.test(existing)) return existing;
    throw new Error('Desktop connector authorization host identifier is invalid');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  const created = `urn:uuid:${randomUUID()}`;
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.writeFile(temporary, `${created}\n`, { mode: 0o600, flag: 'wx' });
  try {
    // Keep the first identifier if another process created one concurrently.
    await fs.link(temporary, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
  } finally {
    await fs.rm(temporary, { force: true });
  }
  const stored = (await fs.readFile(file, 'utf8')).trim();
  if (!HOST_ID_PATTERN.test(stored)) {
    throw new Error('Desktop connector authorization host identifier is invalid');
  }
  return stored;
}
