import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import './check-kit-first-style.mjs';

function validatePermissionDeclarations(manifestText) {
  const parsed = parseYaml(manifestText);
  if (!Array.isArray(parsed?.permissions)) {
    throw new Error('permissions must be the top-level public permission declaration array');
  }
  if (parsed.permissions.length !== 0) {
    throw new Error('Tester must declare no permissions while the admitted public permission set is empty');
  }
  for (const retired of ['declared_nimi_api_scopes', 'scope', 'qualifier', 'operation_id', 'resource_ref']) {
    if (Object.hasOwn(parsed, retired) || Object.hasOwn(parsed?.permissions ?? {}, retired)) {
      throw new Error(`retired permission vocabulary remains: ${retired}`);
    }
  }
}

const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');
if (!manifest.includes('manifest_role: submitted-input')) {
  throw new Error('submitted manifest role marker missing');
}
validatePermissionDeclarations(manifest);
const submissionUrl = new URL('../.nimi/admission/submission.yaml', import.meta.url);
const buildProfileUrl = new URL('../.nimi/admission/build-profile.yaml', import.meta.url);
if (existsSync(submissionUrl) && existsSync(buildProfileUrl)) {
  const submission = readFileSync(submissionUrl, 'utf8');
  const buildProfile = readFileSync(buildProfileUrl, 'utf8');
  if (!submission.includes('submission_role: developer-submitted-input')) {
    throw new Error('developer submission role marker missing');
  }
  if (!submission.includes('dev_command: pnpm dev')) {
    throw new Error('dev shell command marker missing');
  }
  if (!submission.includes('init_command: pnpm run init')) {
    throw new Error('init command marker missing');
  }
  if (!buildProfile.includes('profile_role: developer-workflow-input')) {
    throw new Error('developer build profile marker missing');
  }
} else {
  const admission = readFileSync(new URL('../ADMISSION.md', import.meta.url), 'utf8');
  if (!admission.includes('developer-submitted listing request')) {
    throw new Error('reference admission request marker missing');
  }
}
console.log('[nimi-app] validate pre-submission self-check passed');
