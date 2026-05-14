import fs from 'node:fs';
import path from 'node:path';

import { normalizeDesktopUpdaterPublicKey } from './desktop-updater-public-key.mjs';

const DEFAULT_UPDATE_ENDPOINT = 'https://install.nimi.ai/desktop/latest.json';

function normalizeEndpoint(input) {
  const raw = String(input || '').trim() || DEFAULT_UPDATE_ENDPOINT;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`NIMI_DESKTOP_UPDATER_ENDPOINT must be an absolute URL: ${raw}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`NIMI_DESKTOP_UPDATER_ENDPOINT must use https: ${raw}`);
  }
  return url.toString();
}

export function createDesktopUpdaterTauriConfig(input) {
  const publicKey = normalizeDesktopUpdaterPublicKey(input?.publicKey || '');
  const endpoint = normalizeEndpoint(input?.endpoint);
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

export function writeDesktopUpdaterTauriConfig(outputPath, input) {
  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const config = createDesktopUpdaterTauriConfig(input);
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return target;
}
