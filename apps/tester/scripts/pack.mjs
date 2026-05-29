import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (!existsSync(join('dist', 'index.html'))) {
  throw new Error('renderer build output missing: run pnpm run build before packing');
}
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const tauriConfig = JSON.parse(readFileSync(join('src-tauri', 'tauri.conf.json'), 'utf8'));
const manifest = readFileSync('nimi.app.yaml', 'utf8');
const submission = readFileSync(join('.nimi', 'admission', 'submission.yaml'), 'utf8');
const buildProfile = readFileSync(join('.nimi', 'admission', 'build-profile.yaml'), 'utf8');
if (!manifest.includes('manifest_role: submitted-input')) {
  throw new Error('submitted manifest role marker missing');
}
if (!submission.includes('submission_role: developer-submitted-input')) {
  throw new Error('developer submission role marker missing');
}
if (!buildProfile.includes('profile_role: developer-workflow-input')) {
  throw new Error('developer build profile marker missing');
}
mkdirSync('dist', { recursive: true });
const packet = {
  packetRole: 'developer-submitted-input',
  packageName: packageJson.name,
  appVersion: tauriConfig.version,
  tauriIdentifier: tauriConfig.identifier,
  rendererEntry: 'dist/index.html',
  manifestPath: 'nimi.app.yaml',
  admissionRequestPath: '.nimi/admission/submission.yaml',
  buildProfilePath: '.nimi/admission/build-profile.yaml',
  generatedBy: '@nimiplatform/app-tools',
};
writeFileSync(join('dist', 'nimi-app-submission.json'), `${JSON.stringify(packet, null, 2)}\n`);
console.log('[nimi-app] pack wrote dist/nimi-app-submission.json');
