import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer, resolveConfig } from 'vite';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const identityPath = '/__nimi_web_dev__';

function serverIdentity(config) {
  const root = realpathSync(config.root);
  return {
    application: 'nimi-web',
    workspace: createHash('sha256').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('hex'),
    mode: config.mode,
  };
}

// This identifies accidental duplicate development servers, not an auth boundary.
function identityPlugin() {
  return {
    name: 'nimi-web-dev-identity',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      const identity = JSON.stringify(serverIdentity(server.config));
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== identityPath) return next();
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(identity);
      });
    },
  };
}

async function isSameServer(url, identity) {
  try {
    const response = await fetch(new URL(identityPath, url), {
      signal: AbortSignal.timeout(1500),
      redirect: 'error',
    });
    if (!response.ok) return false;
    const actual = await response.json();
    return actual.application === identity.application
      && actual.workspace === identity.workspace
      && actual.mode === identity.mode;
  } catch {
    return false;
  }
}

export async function startWebDevServer(options = {}) {
  const config = await resolveConfig({
    ...options,
    root: options.root ?? webRoot,
    plugins: [...(options.plugins ?? []), identityPlugin()],
    server: { ...options.server, strictPort: true },
  }, 'serve');
  const { port, host, https } = config.server;
  const probeHost = host === true || host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host || 'localhost';
  const url = `${https ? 'https' : 'http'}://${probeHost.includes(':') && !probeHost.startsWith('[') ? `[${probeHost}]` : probeHost}:${port}/`;
  const identity = serverIdentity(config);
  const reuse = () => {
    config.logger.info(`[web-dev] Reusing this workspace's Web server: ${url}`);
    return { reused: true, url, server: null };
  };
  if (port !== 0 && await isSameServer(url, identity)) return reuse();

  const server = await createServer(config);
  try {
    await server.listen();
    return { reused: false, url: server.resolvedUrls?.local[0] ?? url, server };
  } catch (error) {
    await server.close();
    if (error?.code !== 'EADDRINUSE' && error?.message !== `Port ${port} is already in use`) throw error;
    // Another task may have won the listen race after our initial probe.
    if (await isSameServer(url, identity)) return reuse();
    throw new Error(`Port ${port} is occupied, but its service is not a matching Web server for this workspace and mode. Stop the conflicting service explicitly or choose --port <port>.`, { cause: error });
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== '--'),
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      mode: { type: 'string', short: 'm' },
      config: { type: 'string', short: 'c' },
      base: { type: 'string' },
      open: { type: 'boolean' },
      force: { type: 'boolean' },
      strictPort: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Nimi Web dev: [--port <port>] [--host <host>] [--mode <mode>] [--config <file>] [--base <path>] [--open] [--force]\nReuses the same workspace and mode when already running; ports are always strict.');
    return;
  }
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error('--port must be an integer from 0 to 65535.');
  const result = await startWebDevServer({
    mode: values.mode,
    configFile: values.config,
    base: values.base,
    forceOptimizeDeps: values.force,
    server: { port, host: values.host, open: values.open },
  });
  if (result.server) {
    result.server.printUrls();
    result.server.bindCLIShortcuts({ print: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[web-dev] ${error.message}`);
    process.exitCode = 1;
  });
}
