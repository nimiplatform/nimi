#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { GENERATED_ROOT, REPO_ROOT, SIMULATOR_ROOT } from './paths.mjs';
import { loadQualificationInputs, runFreshQualification } from './qualification.mjs';
import { QualificationCacheMiss, validateQualificationCache } from './qualification-cache.mjs';

export function prepareDevModules({ log = (message) => process.stdout.write(`${message}\n`) } = {}) {
  const startedAt = performance.now();
  const inputs = loadQualificationInputs();

  try {
    const cache = validateQualificationCache({
      ...inputs,
      generatedRoot: GENERATED_ROOT,
      repoRoot: REPO_ROOT,
      simulatorRoot: SIMULATOR_ROOT,
    });
    const elapsed = Math.round(performance.now() - startedAt);
    log(`simulator-modules: cache hit (${elapsed} ms, registry ${cache.registryDigest})`);
    return { status: 'cache-hit', elapsed, registryDigest: cache.registryDigest };
  } catch (error) {
    const reason = error instanceof QualificationCacheMiss
      ? error.reason
      : `cache-validation-error:${error instanceof Error ? error.message : String(error)}`;
    log(`simulator-modules: cache miss (${reason}); rebuilding`);
    const registry = runFreshQualification(inputs, { release: false });
    const elapsed = Math.round(performance.now() - startedAt);
    log(`simulator-modules: rebuilt (${elapsed} ms, ${registry.moduleCount} modules, registry ${registry.digest})`);
    return { status: 'rebuilt', elapsed, registryDigest: registry.digest, reason };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) prepareDevModules();
