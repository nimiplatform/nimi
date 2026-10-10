#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildProductUpdateManifest, readProductManifestInput } from '../lib/product-update-manifest.mjs';
import { verifySignedMacOSInstaller } from '../../apps/desktop/scripts/lib/macos-release-process.mjs';
import { PRODUCT_UPDATE_POLICY } from '../../config/product-update-policy.mjs';
import { runReleaseCommand } from '../../apps/desktop/scripts/lib/macos-release-process.mjs';
import { verifyWindowsUnsignedInstaller } from '../lib/windows-product-release.mjs';

const args = process.argv.slice(2), options = {};
if (args[0] === '--') args.shift();
for (let index = 0; index < args.length; index += 2) {
  if (!['--identity', '--asset', '--admission', '--signing-key', '--output','--inventory'].includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error('Invalid product manifest arguments');
  options[args[index]] = args[index + 1];
}
if (['--identity','--asset','--admission','--signing-key','--output'].some((name)=>!options[name])) throw new Error('Required: --identity --asset --admission --signing-key --output [--inventory for Windows]');
if (!PRODUCT_UPDATE_POLICY.publicKey) throw new Error('UPDATE_TRUST_NOT_CONFIGURED');
const output = path.resolve(options['--output']);
const local = path.resolve('.nimi/local');
if (!output.startsWith(`${local}${path.sep}`)) throw new Error('Product manifest preparation output must be under .nimi/local');
const identity = await readProductManifestInput(options['--identity']);
if (identity.target === 'macos-arm64') {
  verifySignedMacOSInstaller(options['--asset']);
  const signature = runReleaseCommand('/usr/sbin/pkgutil', ['--check-signature', options['--asset']]).stdout;
  if (!new RegExp(`1\\. Developer ID Installer: [^\\n]+\\(${PRODUCT_UPDATE_POLICY.macOSTeamId}\\)`, 'u').test(signature)) throw new Error('Installer publisher mismatch');
}
else if (identity.target === 'windows-amd64') await verifyWindowsUnsignedInstaller(options['--asset']);
else throw new Error('Unsupported formal installer target');
const envelope = await buildProductUpdateManifest({ identity, assetPath: options['--asset'],
  installedInventory: options['--inventory'] ? await readProductManifestInput(options['--inventory']) : undefined,
  admission: await readProductManifestInput(options['--admission']), privateKey: await readFile(options['--signing-key']) });
await writeFile(output, `${JSON.stringify(envelope)}\n`, { flag: 'wx', mode: 0o600 });
process.stdout.write(`Prepared signed product manifest: ${output}\n`);
