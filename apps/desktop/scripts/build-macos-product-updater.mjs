import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { runReleaseCommand } from './lib/macos-release-process.mjs';
import { macOSPublicProductRelease } from './lib/macos-release-process.mjs';

export function macOSUpdaterBuildPublicKey(realmOrigin='https://realm.nimi.ai', publicKey=PRODUCT_UPDATE_POLICY.publicKey) {
  return macOSPublicProductRelease(realmOrigin) ? (publicKey ?? '') : '';
}

export async function buildMacOSProductUpdater(outputRoot, realmOrigin='https://realm.nimi.ai') {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Mac product updater requires native arm64 build');
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const constants = path.join(outputRoot, 'UpdatePolicy.swift');
  await writeFile(constants, `let updatePublicKey = ${JSON.stringify(macOSUpdaterBuildPublicKey(realmOrigin))}\nlet updateTeamId = ${JSON.stringify(PRODUCT_UPDATE_POLICY.macOSTeamId)}\nlet updateChannel = ${JSON.stringify(PRODUCT_UPDATE_POLICY.channel)}\n`);
  const binary = path.join(outputRoot, 'Nimi Product Updater');
  runReleaseCommand('/usr/bin/swiftc', ['-O', '-target', 'arm64-apple-macosx13.0',
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../macos/product-updater/main.swift'), constants, '-o', binary]);
  return binary;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = path.resolve(process.argv[2] ?? '.nimi/local/macos-product-updater');
  if (!destination.startsWith(path.resolve('.nimi/local') + path.sep)) throw new Error('Updater build output must be under .nimi/local');
  process.stdout.write(`${await buildMacOSProductUpdater(destination)}\n`);
}
