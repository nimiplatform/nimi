import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

function listSettingsSurfaceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSettingsSurfaceFiles(next);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [next] : [];
  }).sort();
}

export function readTesterSettingsSurface(root) {
  const route = path.join(root, 'src/shell/routes/settings.tsx');
  const modules = listSettingsSurfaceFiles(path.join(root, 'src/shell/routes/settings'));
  return [route, ...modules].map((filePath) => readFileSync(filePath, 'utf8')).join('\n');
}
