import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SimulatorConformanceError } from './simulator-manifest.mjs';

export const SIMULATOR_CANONICAL_KIT_EXPORT_REQUIREMENTS = Object.freeze([
  Object.freeze({
    subpath: './features/agent-center',
    exports: Object.freeze(['createAppAgentCenterSession', 'AppAgentCenterEntry']),
  }),
  Object.freeze({
    subpath: './features/chat',
    exports: Object.freeze(['AppConversationEntry', 'createBrowserAppConversationHostPort']),
  }),
  Object.freeze({
    subpath: './features/agent-realtime',
    exports: Object.freeze(['AgentRealtimeEntry', 'createBrowserAgentRealtimeHostMediaPort']),
  }),
]);

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function exactPackageTarget(packageRoot, value, fieldPath) {
  if (typeof value !== 'string' || !value.startsWith('./') || value.includes('..') || value.includes('\\')) {
    fail('SIM_KIT_EXPORT_TARGET_INVALID', 'Kit package export target is invalid', fieldPath);
  }
  const root = realpathSync(packageRoot);
  const absolute = path.resolve(root, value);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    fail('SIM_KIT_EXPORT_TARGET_ESCAPE', 'Kit package export target escapes its package root', fieldPath);
  }
  try {
    if (!statSync(absolute).isFile()) fail('SIM_KIT_EXPORT_TARGET_MISSING', 'Kit package export target is not a file', fieldPath);
  } catch {
    fail('SIM_KIT_EXPORT_TARGET_MISSING', 'Kit package export target is missing', fieldPath);
  }
  return realpathSync(absolute);
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c
export async function validateSimulatorCanonicalKitExports(input) {
  const packageRoot = realpathSync(String(input?.kitPackageRoot || ''));
  const requirements = input?.requirements ?? SIMULATOR_CANONICAL_KIT_EXPORT_REQUIREMENTS;
  if (!Array.isArray(requirements) || requirements.length === 0) {
    fail('SIM_KIT_EXPORT_REQUIREMENTS_INVALID', 'Canonical Kit export requirements are missing');
  }
  const packageJson = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const resolved = [];
  for (const requirement of requirements) {
    const subpath = String(requirement?.subpath || '');
    const names = requirement?.exports;
    if (!subpath.startsWith('./') || !Array.isArray(names) || names.length === 0
      || names.some((name) => typeof name !== 'string' || !name || name !== name.trim())) {
      fail('SIM_KIT_EXPORT_REQUIREMENTS_INVALID', 'Canonical Kit export requirement is invalid', subpath);
    }
    const row = packageJson.exports?.[subpath];
    const importTarget = typeof row === 'string' ? row : row?.import ?? row?.default;
    const target = exactPackageTarget(packageRoot, importTarget, subpath);
    const module = await import(`${pathToFileURL(target).href}?simulator-conformance=${encodeURIComponent(subpath)}`);
    for (const name of names) {
      if (!Object.hasOwn(module, name) || typeof module[name] === 'undefined') {
        fail('SIM_KIT_EXPORT_MISSING', `Kit ${subpath} does not export ${name}`, `${subpath}.${name}`);
      }
    }
    resolved.push(Object.freeze({ subpath, exports: Object.freeze([...names]), target }));
  }
  return Object.freeze(resolved);
}
