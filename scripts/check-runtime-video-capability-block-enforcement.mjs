#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const typesPath = path.join(repoRoot, 'runtime', 'internal', 'services', 'ai', 'catalog', 'types.go');
const loaderPath = path.join(repoRoot, 'runtime', 'internal', 'services', 'ai', 'catalog', 'loader.go');
const jobStorePath = path.join(repoRoot, 'runtime', 'internal', 'services', 'ai', 'scenario_job_store.go');
const validationPath = path.join(repoRoot, 'runtime', 'internal', 'services', 'ai', 'scenario_catalog_validation.go');
const testPath = path.join(repoRoot, 'runtime', 'internal', 'services', 'ai', 'scenario_catalog_validation_test.go');

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function assertContains(absPath, pattern, label) {
  const relPath = path.relative(repoRoot, absPath);
  const content = fs.readFileSync(absPath, 'utf8');
  if (!pattern.test(content)) {
    fail(`${relPath} missing required enforcement fragment: ${label}`);
  }
}

function main() {
  assertContains(typesPath, /type VideoGenerationCapability struct \{/, 'typed VideoGenerationCapability');
  assertContains(typesPath, /InputRoles\s+map\[string\]\[\]string/, 'typed input_roles');
  assertContains(typesPath, /Options\s+VideoGenerationOptions/, 'typed options');
  assertContains(typesPath, /Outputs\s+VideoGenerationOutputs/, 'typed outputs');

  assertContains(loaderPath, /video_generation\.options\.supports must not be empty/, 'loader options.supports validation');
  assertContains(loaderPath, /video_generation\.outputs must declare at least one artifact/, 'loader outputs validation');

  assertContains(jobStorePath, /validateCatalogAwareScenarioSupport\(/, 'catalog-aware validation hook');

  assertContains(validationPath, /SCENARIO_TYPE_VIDEO_GENERATE/, 'video scenario enforcement entry');
  assertContains(validationPath, /InputRoles\[modeToken\]/, 'provider-specific input role enforcement');
  assertContains(validationPath, /ensureVideoOptionSupported/, 'option whitelist enforcement');
  assertContains(validationPath, /return_last_frame/, 'output enforcement');
  assertContains(validationPath, /reference_images/, 'reference image limit enforcement');

  if (!fs.existsSync(testPath)) {
    fail(`${path.relative(repoRoot, testPath)} must exist`);
  } else {
    assertContains(testPath, /TestValidateVideoGenerateAgainstCatalogAllowsDeclaredOptions/, 'positive coverage test');
    assertContains(testPath, /TestValidateVideoGenerateAgainstCatalogRejectsUndeclaredOption/, 'unsupported option coverage test');
    assertContains(testPath, /TestValidateVideoGenerateAgainstCatalogRejectsUnavailableOutput/, 'output enforcement coverage test');
  }

  if (failed) {
    process.exit(1);
  }

  console.log('runtime-video-capability-block-enforcement: OK');
}

main();
