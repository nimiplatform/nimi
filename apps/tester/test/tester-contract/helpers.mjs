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
    'src/tester/local-app-conversation-journey.ts',
    'src/tester/tester-ai-config-store.ts',
    'src/tester/tester-run-target.ts',
    'src/tester/tester-history.ts',
    'src/tester/workbench/section-ai-testing-admission.ts',
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
