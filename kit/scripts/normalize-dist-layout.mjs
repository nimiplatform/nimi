import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDirIndex = process.argv.indexOf('--out-dir');
const outDirArgument = outDirIndex >= 0 ? process.argv[outDirIndex + 1] : 'dist';
if (!outDirArgument || (outDirIndex >= 0 && outDirArgument.startsWith('--'))) {
  throw new Error('Missing value after --out-dir');
}
const distRoot = path.resolve(kitRoot, outDirArgument);

const srcRoots = [
  'auth/src',
  'core/src',
  'shell/capabilities/src',
  'shell/electron/src',
  'shell/renderer/src',
  'telemetry/src',
  'ui/src',
];

const featuresRoot = path.join(distRoot, 'features');
if (existsSync(featuresRoot)) {
  const { readdirSync, statSync } = await import('node:fs');
  for (const entry of readdirSync(featuresRoot)) {
    const candidate = path.join(featuresRoot, entry);
    if (statSync(candidate).isDirectory()) {
      srcRoots.push(`features/${entry}/src`);
    }
  }
}

for (const relativeSrcRoot of srcRoots) {
  const source = path.join(distRoot, relativeSrcRoot);
  if (!existsSync(source)) {
    continue;
  }
  const target = path.join(distRoot, relativeSrcRoot.replace(/\/src$/u, ''));
  cpSync(source, target, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
}
