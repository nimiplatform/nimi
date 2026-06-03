import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function listSettingsSurfaceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSettingsSurfaceFiles(next);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [next] : [];
  }).sort();
}

export function readTesterSettingsSurface(repoRoot: string | URL): string {
  const root = repoRoot instanceof URL ? fileURLToPath(repoRoot) : repoRoot;
  const route = path.join(root, 'apps/tester/src/shell/routes/settings.tsx');
  const modules = listSettingsSurfaceFiles(path.join(root, 'apps/tester/src/shell/routes/settings'));
  return [route, ...modules].map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
}
