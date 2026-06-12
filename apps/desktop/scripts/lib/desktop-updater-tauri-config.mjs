import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeDesktopUpdaterPublicKey } from './desktop-updater-public-key.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..', '..');
const DEFAULT_RUST_UPDATER_SOURCE_PATH = path.join(desktopRoot, 'src-tauri', 'src', 'desktop_updates.rs');

function readRustDefaultUpdaterEndpoint(rustSourcePath = DEFAULT_RUST_UPDATER_SOURCE_PATH) {
  const source = fs.readFileSync(rustSourcePath, 'utf8');
  const match = source.match(/const\s+DEFAULT_UPDATE_ENDPOINT\s*:\s*&str\s*=\s*"([^"]+)"/u);
  if (!match?.[1]) {
    throw new Error(`Rust updater source does not define DEFAULT_UPDATE_ENDPOINT: ${rustSourcePath}`);
  }
  return match[1];
}

function normalizeEndpoint(input, options = {}) {
  const raw = String(input || '').trim() || readRustDefaultUpdaterEndpoint(options.rustSourcePath);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`desktop updater endpoint must be an absolute URL: ${raw}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`desktop updater endpoint must use https: ${raw}`);
  }
  return url.toString();
}

export function createDesktopUpdaterTauriConfig(input) {
  const publicKey = normalizeDesktopUpdaterPublicKey(input?.publicKey || '');
  const endpoint = normalizeEndpoint(input?.endpoint, {
    rustSourcePath: input?.rustSourcePath,
  });
  return {
    plugins: {
      updater: {
        pubkey: publicKey,
        endpoints: [endpoint],
        windows: {
          installMode: 'passive',
        },
      },
    },
  };
}

export const desktopUpdaterTauriConfigAuthority = {
  rustSourcePath: DEFAULT_RUST_UPDATER_SOURCE_PATH,
  endpointSource: 'apps/desktop/src-tauri/src/desktop_updates.rs::DEFAULT_UPDATE_ENDPOINT',
  publicKeySource: 'apps/desktop/src-tauri/src/desktop_updates.rs::NIMI_DESKTOP_UPDATER_PUBLIC_KEY option_env',
};

export { readRustDefaultUpdaterEndpoint };

export function writeDesktopUpdaterTauriConfig(outputPath, input) {
  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const config = createDesktopUpdaterTauriConfig(input);
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return target;
}
