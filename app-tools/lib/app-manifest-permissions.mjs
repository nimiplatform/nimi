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
const RUNTIME_ARTIFACT_SCOPES = new Set(['data.scope.read']);
const CANONICAL_PERMISSION_QUALIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,158}[A-Za-z0-9])?$/;

export function assertManifestPermissionDeclarations(manifest, manifestPath) {
  let parsed;
  try {
    parsed = parseYaml(manifest);
  } catch (error) {
    throw new Error(`Submitted manifest YAML cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const declarations = parsed?.permissions?.declared_nimi_api_scopes;
  if (declarations == null) return;
  if (!Array.isArray(declarations)) {
    throw new Error('Submitted manifest declared_nimi_api_scopes must be an array');
  }
  for (const [index, declaration] of declarations.entries()) {
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
      throw new Error(`Submitted manifest permission declaration ${index} must be an object`);
    }
    const scope = typeof declaration.scope === 'string' ? declaration.scope.trim() : '';
    const qualifier = typeof declaration.qualifier === 'string' ? declaration.qualifier.trim() : '';
    const purpose = typeof declaration.purpose === 'string' ? declaration.purpose.trim() : '';
    if (!scope || !purpose) {
      throw new Error(`Submitted manifest permission declaration ${index} requires scope and purpose`);
    }
    if (!CLOSED_PERMISSION_SCOPES.has(scope)) {
      throw new Error(`Submitted manifest permission declaration ${index} uses non-canonical scope: ${scope}`);
    }
    if (typeof declaration.qualifier === 'string' && qualifier.length === 0) {
      throw new Error(`Submitted manifest permission declaration ${index} qualifier must be omitted or non-empty`);
    }
    if (qualifier && !CANONICAL_PERMISSION_QUALIFIER.test(qualifier)) {
      throw new Error(`Submitted manifest permission declaration ${index} uses non-canonical qualifier: ${qualifier}`);
    }
    if (qualifier === 'app-local-drafts' && !APP_LOCAL_DRAFTS_SCOPES.has(scope)) {
      throw new Error(`Submitted manifest permission declaration ${index} app-local-drafts qualifier is only admitted for file.read.scoped or file.write.scoped`);
    }
    if (qualifier === 'runtime.artifacts' && !RUNTIME_ARTIFACT_SCOPES.has(scope)) {
      throw new Error(`Submitted manifest permission declaration ${index} runtime.artifacts qualifier is only admitted for data.scope.read`);
    }
    for (const grantField of ['grantId', 'grant_id', 'state', 'granted', 'granted_permissions']) {
      if (Object.hasOwn(declaration, grantField)) {
        throw new Error(`Submitted manifest permission declaration ${index} contains grant lifecycle field ${grantField}`);
      }
    }
  }
  if (!manifestPath.endsWith('nimi.app.yaml')) {
    throw new Error('Submitted manifest permission declarations were not read from nimi.app.yaml');
  }
}
