export const sdkLocalAppAuthorityInputs = Object.freeze({
  appClient: 'docs/authority/sdks-feature-clients-rationale.md',
  runtime: 'docs/authority/sdks-client-core-rationale.md',
  transport: 'docs/authority/sdks-client-core-rationale.md',
  index: '.nimi/spec/sdks/kernel/index.md',
  methodGroups: 'config/sdks-runtime-method-groups.yaml',
});

// The runtime and transport contract prose now lives verbatim inside the
// client-core rationale document; each retired source file is one section
// delimited by `<!-- source: ... -->` markers. Extraction is fail-closed: a
// missing marker yields an empty section, which the validator rejects.
export const sdkLocalAppRationaleSections = Object.freeze({
  runtime: 'runtime-contract.md',
  transport: 'transport-contract.md',
  appClient: 'nimi-app-client-contract.md',
});

export function extractSdkRationaleSection(text, sourceBasename) {
  const source = String(text || '');
  const escaped = String(sourceBasename || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const marker = new RegExp(`^<!-- source: \\S+/${escaped} -->$`, 'mu').exec(source);
  if (!marker) return '';
  const end = source.indexOf('<!-- source: ', marker.index + marker[0].length);
  return source.slice(marker.index, end === -1 ? source.length : end);
}

const forbiddenVocabulary = Object.freeze([
  'ACCOUNT_CALLER_MODE_LOCAL_DEVELOPER_APP',
  'ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_NIMI_APP',
  'OpenLocalDevelopmentAppSession',
  'OpenDesktopLaunchedAppSession',
  'AdoptLocalApp',
  'ListLocalAppAdoptions',
  'RemoveLocalAppAdoption',
  'BindInstalledLaunchProcess',
  'RuntimeGrantService',
  'GetLocalAppGrantStatus',
  'RequestLocalAppGrant',
  'DecideLocalAppGrant',
  'RevokeLocalAppGrant',
]);

const requiredMethodsByGroup = Object.freeze({
  auth_service_projection: ['OpenLocalAppSession'],
  account_service_projection: [
    'GetLocalAppPermissionStatus',
    'RequestLocalAppPermission',
  ],
  local_development_service_projection: [
    'GetDeveloperModeStatus',
    'SetDeveloperMode',
    'EvaluateLocalDevelopmentProject',
    'DecideLocalDevelopmentProject',
    'ListLocalDevelopmentAuthorizations',
    'RevokeLocalDevelopmentAuthorization',
    'EndLocalDevelopmentRun',
  ],
  app_lifecycle_service_projection: ['PrepareLocalAppLaunch', 'BindLocalAppProcess'],
});

export function validateSdkLocalAppAuthority(input) {
  const errors = [];
  const textEntries = [
    ['appClient', input?.appClient],
    ['runtime', input?.runtime],
    ['transport', input?.transport],
    ['index', input?.index],
  ].map(([name, value]) => [name, String(value || '')]);
  const allText = textEntries.map(([, value]) => value).join('\n');
  const methodGroups = input?.methodGroups && typeof input.methodGroups === 'object'
    ? input.methodGroups
    : {};
  const serializedAuthority = `${allText}\n${JSON.stringify(methodGroups)}`;

  for (const symbol of forbiddenVocabulary) {
    if (serializedAuthority.includes(symbol)) errors.push(`retired SDK authority vocabulary remains: ${symbol}`);
  }

  const requiredText = [
    ['appClient', 'local-app'],
    ['appClient', 'standardShell'],
    ['appClient', 'base entitlements'],
    ['appClient', 'public-permission'],
    ['runtime', 'LOCAL_APP'],
    ['runtime', 'principal'],
    ['transport', 'host-injected'],
    ['transport', 'request-empty'],
    ['index', 'nimi-app-client-contract.md'],
  ];
  const textByName = new Map(textEntries);
  for (const [name, token] of requiredText) {
    if (!textByName.get(name)?.includes(token)) errors.push(`${name} authority missing required token: ${token}`);
  }

  const groups = Array.isArray(methodGroups?.groups) ? methodGroups.groups : [];
  for (const [groupName, requiredMethods] of Object.entries(requiredMethodsByGroup)) {
    const group = groups.find((row) => row?.group === groupName);
    if (!group) {
      errors.push(`runtime-method-groups missing group: ${groupName}`);
      continue;
    }
    const methods = new Set((Array.isArray(group?.methods) ? group.methods : []).map(String));
    for (const method of requiredMethods) {
      if (!methods.has(method)) errors.push(`${groupName} missing method: ${method}`);
    }
  }

  return errors;
}

