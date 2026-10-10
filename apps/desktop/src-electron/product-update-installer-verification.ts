import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProductUpdateError, type ProductRelease } from '../../../config/product-update-contract.mjs';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { verifyWindowsUnsignedInstaller } from '../../../config/windows-product-installer.mjs';

const execute = promisify(execFile);
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-pkgrel-010
export async function verifyProductInstaller(file: string, release: ProductRelease): Promise<void> {
  if (process.platform === 'win32' && process.arch === 'x64' && release.target === 'windows-amd64' && release.channel === 'beta' && release.asset.installer === 'windows-exe') {
    // Host has already authenticated the admitted metadata and checked exact
    // SHA/size. Native readiness and UAC reverify remain separate install gates.
    await verifyWindowsUnsignedInstaller(file); return;
  }
  if (process.platform !== 'darwin' || release.target !== 'macos-arm64' || release.asset.installer !== 'macos-pkg') {
    // Windows unsigned protected admission and formal installer remain with
    // their native owners. A digest never bypasses that prerequisite.
    throw new ProductUpdateError('UPDATE_INSTALLER_UNSUPPORTED');
  }
  try {
    const result = await execute('/usr/sbin/pkgutil', ['--check-signature', file], { timeout: 30_000, maxBuffer: 64 * 1024, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' } });
    if (!new RegExp(`1\\. Developer ID Installer: [^\\n]+\\(${PRODUCT_UPDATE_POLICY.macOSTeamId}\\)`, 'u').test(result.stdout)
      || !/Status: signed by a developer certificate issued by Apple for distribution/u.test(result.stdout)) throw new Error('signature');
    const assessment = await execute('/usr/sbin/spctl', ['--assess', '--type', 'install', '--verbose=2', file], { timeout: 30_000, maxBuffer: 64 * 1024, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' } });
    // Gatekeeper verifies notarization for the actual installer bytes, even
    // at candidate.part. A local exception or disabled assessment is not the
    // admitted notarized trust result. stapler remains a build tool; ordinary
    // users need neither Xcode nor Command Line Tools to verify an update.
    if (!/^source=Notarized Developer ID\r?$/mu.test(`${assessment.stdout}\n${assessment.stderr}`)) throw new Error('notarization');
  } catch { throw new ProductUpdateError('UPDATE_INSTALLER_TRUST_FAILED'); }
}
