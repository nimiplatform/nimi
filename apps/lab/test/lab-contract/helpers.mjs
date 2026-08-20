import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { buildWithTsc } from '../tsc-build.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const root = path.resolve(import.meta.dirname, '../..');

let behaviorBuildDir = null;

function buildBehaviorModules() {
  if (behaviorBuildDir) return behaviorBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  behaviorBuildDir = mkdtempSync(path.join(root, '.tmp', 'behavior-'));
  buildWithTsc([
    '--outDir',
    behaviorBuildDir,
    '--rootDir',
    'src',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--jsx',
    'react-jsx',
    '--skipLibCheck',
    'true',
    '--types',
    'node',
    '--noEmit',
    'false',
    'src/lab/local-app-conversation-journey.ts',
    'src/lab/lab-ai-config-store.ts',
    'src/lab/lab-capabilities.ts',
    'src/lab/lab-run-target.ts',
    'src/ai-studio-core/history.ts',
    'src/ai-studio-core/section-ai-testing-admission.ts',
    'src/lab/app-access/app-access-catalog.ts',
    'src/lab/app-access/app-access-probes.ts',
    'src/lab/app-access/app-access-state.ts',
    'src/lab/app-access/app-access-mapping.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return behaviorBuildDir;
}

export async function importBehaviorModule(relativePath) {
  const buildDir = buildBehaviorModules();
  return import(pathToFileURL(path.join(buildDir, relativePath)).href);
}

export function cleanupBehaviorModules() {
  if (behaviorBuildDir) {
    rmSync(behaviorBuildDir, { recursive: true, force: true });
    behaviorBuildDir = null;
  }
}
