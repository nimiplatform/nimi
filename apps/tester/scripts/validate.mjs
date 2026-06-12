import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const CLOSED_PERMISSION_SCOPES = new Set([
  'account.read',
  'account.session.read',
  'data.scope.read',
  'data.scope.write',
  'agent.identity.project',
  'agent.identity.bind',
  'ai.spend.meter',
  'ai.spend.delegate',
  'memory.read.bounded',
  'memory.write.admitted',
  'knowledge.read.bounded',
  'knowledge.write.admitted',
  'notification.send',
  'notification.subscribe',
  'file.read.scoped',
  'file.write.scoped',
  'device.use.scoped',
  'audit.read.scoped',
  'ai_profile.selection.consume',
]);
const APP_LOCAL_DRAFTS_SCOPES = new Set(['file.read.scoped', 'file.write.scoped']);

function validatePermissionDeclarations(manifestText) {
  const parsed = parseYaml(manifestText);
  const declarations = parsed?.permissions?.declared_nimi_api_scopes;
  if (declarations == null) return;
  if (!Array.isArray(declarations)) {
    throw new Error('declared_nimi_api_scopes must be an array');
  }
  for (const [index, declaration] of declarations.entries()) {
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
      throw new Error(`permission declaration ${index} must be an object`);
    }
    const scope = typeof declaration.scope === 'string' ? declaration.scope.trim() : '';
    const qualifier = typeof declaration.qualifier === 'string' ? declaration.qualifier.trim() : '';
    const purpose = typeof declaration.purpose === 'string' ? declaration.purpose.trim() : '';
    if (!scope || !purpose) {
      throw new Error(`permission declaration ${index} requires scope and purpose`);
    }
    if (!CLOSED_PERMISSION_SCOPES.has(scope)) {
      throw new Error(`permission declaration ${index} uses non-canonical scope: ${scope}`);
    }
    if (typeof declaration.qualifier === 'string' && qualifier.length === 0) {
      throw new Error(`permission declaration ${index} qualifier must be omitted or non-empty`);
    }
    if (qualifier && qualifier !== 'app-local-drafts') {
      throw new Error(`permission declaration ${index} uses unsupported qualifier: ${qualifier}`);
    }
    if (qualifier === 'app-local-drafts' && !APP_LOCAL_DRAFTS_SCOPES.has(scope)) {
      throw new Error(`permission declaration ${index} app-local-drafts qualifier is only admitted for file.read.scoped or file.write.scoped`);
    }
    for (const grantField of ['grantId', 'grant_id', 'state', 'granted', 'granted_permissions']) {
      if (Object.hasOwn(declaration, grantField)) {
        throw new Error(`permission declaration ${index} contains grant lifecycle field ${grantField}`);
      }
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
