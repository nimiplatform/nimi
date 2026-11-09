// @nimi-authority: rule.nimi.platform.app-ecosystem.mobile-development-entry
export function readMobileDevelopment(manifest, pkg) {
  const mobile = manifest?.local_development?.mobile;
  if (!mobile || typeof mobile !== 'object' || Array.isArray(mobile)
    || Object.keys(mobile).some(key => key !== 'command')) {
    throw new Error('Declare an App-owned local_development.mobile.command in nimi.app.yaml.');
  }
  if (typeof manifest.app_id !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(manifest.app_id)) {
    throw new Error('Mobile development requires a canonical App id.');
  }
  const match = typeof mobile.command === 'string' && /^pnpm run ([A-Za-z0-9][A-Za-z0-9:_.-]*)$/u.exec(mobile.command);
  if (!match) throw new Error('Mobile command must name an App-owned pnpm script.');
  const command = pkg?.scripts?.[match[1]];
  if (typeof command !== 'string' || !command.trim() || /\bnimi-app\s+dev\b/u.test(command)) {
    throw new Error('Mobile dev requires a real, non-recursive App-owned native script.');
  }
  return { command: mobile.command, script: match[1] };
}
