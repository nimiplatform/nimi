export const sdkLocalAppAuthorityInputs = Object.freeze({
  appClient: '.nimi/spec/sdks/kernel/nimi-app-client-contract.md',
  runtime: '.nimi/spec/sdks/kernel/runtime-contract.md',
  transport: '.nimi/spec/sdks/kernel/transport-contract.md',
  index: '.nimi/spec/sdks/kernel/index.md',
  methodGroups: '.nimi/spec/sdks/kernel/tables/runtime-method-groups.yaml',
  evidence: '.nimi/spec/sdks/kernel/tables/rule-evidence.rules-nimi-app-client.yaml',
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
]);

const requiredMethodsByGroup = Object.freeze({
  auth_service_projection: ['OpenLocalAppSession'],
  account_service_projection: [
    'GetLocalAppGrantStatus',
    'RequestLocalAppGrant',
    'DecideLocalAppGrant',
    'RevokeLocalAppGrant',
  ],
  local_development_service_projection: [
    'GetDeveloperModeStatus',
    'SetDeveloperMode',
    'EvaluateLocalDevelopmentProject',
    'DecideLocalDevelopmentProject',
    'ListLocalDevelopmentAuthorizations',
    'ReactivateLocalDevelopmentProject',
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
  const evidence = input?.evidence && typeof input.evidence === 'object' ? input.evidence : {};
  const serializedAuthority = `${allText}\n${JSON.stringify(methodGroups)}`;

  for (const symbol of forbiddenVocabulary) {
    if (serializedAuthority.includes(symbol)) errors.push(`retired SDK authority vocabulary remains: ${symbol}`);
  }

  const requiredText = [
    ['appClient', 'local-first-party-app'],
    ['appClient', 'local-app'],
    ['appClient', 'standardShell'],
    ['appClient', 'zero-grant'],
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

  const evidenceRows = new Map(
    (Array.isArray(evidence?.rules) ? evidence.rules : [])
      .map((row) => [String(row?.rule_id || '').trim(), row]),
  );
  for (let number = 16; number <= 22; number += 1) {
    const ruleID = `S-APP-${String(number).padStart(3, '0')}`;
    const row = evidenceRows.get(ruleID);
    if (!row) {
      errors.push(`SDK local-app rule evidence missing: ${ruleID}`);
      continue;
    }
    if (row?.evidence_requirement !== 'required') {
      errors.push(`${ruleID} evidence_requirement must be required`);
    }
    if (!Array.isArray(row?.evidence_refs) || row.evidence_refs.length === 0) {
      errors.push(`${ruleID} must declare evidence_refs`);
    }
  }

  return errors;
}
