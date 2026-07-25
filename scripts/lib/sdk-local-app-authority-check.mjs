export const sdkLocalAppAuthorityInputs = Object.freeze({
  appClient: '.nimi/spec/sdks/feature-clients.authority.yaml',
  runtime: '.nimi/spec/sdks/client-core.authority.yaml',
  transport: '.nimi/spec/sdks/client-core.authority.yaml',
  methodGroups: 'config/sdks-runtime-method-groups.yaml',
});

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
    ['appClient', 'id: rule.nimi.sdks.feature-clients.r034'],
    ['appClient', 'local-app maps only to the Runtime LOCAL_APP caller where the SDK receives a host-injected typed standard-shell carrier'],
    ['appClient', 'a valid session projects as session-bound independently of every permission so base entitlements may work while protected permissions remain unavailable'],
    ['appClient', 'id: rule.nimi.sdks.feature-clients.r040'],
    ['appClient', 'permissions.status and permissions.request map only to Runtime GetLocalAppPermissionStatus and RequestLocalAppPermission'],
    ['runtime', 'id: rule.nimi.sdks.client-core.r041'],
    ['runtime', 'app-private storage is a base entitlement succeeding for a live principal, session, and account partition without a user permission'],
    ['transport', 'The SDK local-development transport is host-injected by Kit and never renderer-constructed'],
    ['transport', 'request-empty OpenLocalAppSession'],
    ['transport', 'missing operation families remain typed unavailable'],
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

