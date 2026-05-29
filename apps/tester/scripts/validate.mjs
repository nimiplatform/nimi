import { existsSync, readFileSync } from 'node:fs';

const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');
if (!manifest.includes('manifest_role: submitted-input')) {
  throw new Error('submitted manifest role marker missing');
}
const submissionUrl = new URL('../.nimi/admission/submission.yaml', import.meta.url);
const buildProfileUrl = new URL('../.nimi/admission/build-profile.yaml', import.meta.url);
if (existsSync(submissionUrl) && existsSync(buildProfileUrl)) {
  const submission = readFileSync(submissionUrl, 'utf8');
  const buildProfile = readFileSync(buildProfileUrl, 'utf8');
  if (!submission.includes('submission_role: developer-submitted-input')) {
    throw new Error('developer submission role marker missing');
  }
  if (!submission.includes('dev_shell_command: pnpm dev:shell')) {
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
