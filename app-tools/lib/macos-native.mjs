// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-024a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-024b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function command(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status, text: `${result.stdout || ''}\n${result.stderr || ''}`, stdout: result.stdout || '' };
}

function requireCommand(binary, args) {
  const result = command(binary, args);
  if (result.status !== 0) throw new Error(`${path.basename(binary)} native verification failed: ${result.text.trim()}`);
  return result;
}

export function inspectMacOSMachO(bytes) {
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x0100000c || bytes.readUInt32LE(12) !== 2) {
    throw new Error('macOS Runtime entry must be a native arm64 Mach-O executable');
  }
  const count = bytes.readUInt32LE(16);
  const end = 32 + bytes.readUInt32LE(20);
  if (end > bytes.length) throw new Error('Invalid Mach-O load-command extent');
  let cursor = 32;
  let signaturePresent = false;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 8 > end) throw new Error('Invalid Mach-O load command');
    const size = bytes.readUInt32LE(cursor + 4);
    if (size < 8 || cursor + size > end) throw new Error('Invalid Mach-O load-command size');
    if (bytes.readUInt32LE(cursor) === 0x1d) {
      if (signaturePresent || size !== 16) throw new Error('Invalid Mach-O signature command');
      const offset = bytes.readUInt32LE(cursor + 8);
      const signatureSize = bytes.readUInt32LE(cursor + 12);
      if (!signatureSize || offset < end || offset + signatureSize > bytes.length) throw new Error('Invalid Mach-O signature extent');
      signaturePresent = true;
    }
    cursor += size;
  }
  if (cursor !== end) throw new Error('Invalid Mach-O load-command count');
  return { signaturePresent };
}

export function macOSBundleForRuntimeEntry(runtimePath) {
  const executableRoot = path.dirname(runtimePath);
  const contentsRoot = path.dirname(executableRoot);
  const bundleRoot = path.dirname(contentsRoot);
  if (path.basename(executableRoot) !== 'MacOS' || path.basename(contentsRoot) !== 'Contents' || !bundleRoot.endsWith('.app')) {
    throw new Error('macOS Runtime entry must be a direct bundle Contents/MacOS executable');
  }
  return bundleRoot;
}

export function classifyMacOSNativeTrustObservation(observation) {
  if (observation.signature === 'absent' || observation.signature === 'ad-hoc') {
    if (observation.certificateSubject !== null || observation.notarization !== 'absent') throw new Error('macOS absent publisher identity has contradictory native metadata');
    return { posture: 'production-unsigned', macos_developer_id: 'absent', macos_notarization: 'absent', certificate_subject: null };
  }
  if (observation.signature === 'developer-id-valid' && typeof observation.certificateSubject === 'string' && observation.certificateSubject.trim() === observation.certificateSubject && observation.certificateSubject && ['absent', 'notarized'].includes(observation.notarization)) {
    return { posture: 'observed-valid-native-signature', macos_developer_id: 'valid', macos_notarization: observation.notarization, certificate_subject: observation.certificateSubject };
  }
  throw new Error('macOS native signature or notarization is invalid or unresolved');
}

export function observeMacOSExecutableFacts(runtimePath) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Production macOS pack must run on macos-aarch64');
  const bundleRoot = macOSBundleForRuntimeEntry(runtimePath);
  const bytes = readFileSync(runtimePath);
  const { signaturePresent } = inspectMacOSMachO(bytes);
  const info = JSON.parse(requireCommand('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundleRoot, 'Contents', 'Info.plist')]).stdout);
  if (info.CFBundleExecutable !== path.basename(runtimePath) || Object.hasOwn(info, 'SMPrivilegedExecutables') || existsSync(path.join(bundleRoot, 'Contents', 'Library', 'LaunchDaemons'))) {
    throw new Error('macOS bundle does not satisfy the ordinary current-user execution profile');
  }
  const detail = command('/usr/bin/codesign', ['--display', '--verbose=4', bundleRoot]);
  let observation;
  if (!signaturePresent) {
    if (detail.status === 0 || !/code object is not signed at all/u.test(detail.text)) throw new Error('macOS unsigned observation is unresolved');
    observation = { signature: 'absent', certificateSubject: null, notarization: 'absent' };
  } else {
    if (detail.status !== 0) throw new Error(`macOS code signature is unreadable: ${detail.text.trim()}`);
    requireCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundleRoot]);
    if (/^Signature=adhoc$/mu.test(detail.text)) {
      observation = { signature: 'ad-hoc', certificateSubject: null, notarization: 'absent' };
    } else {
      requireCommand('/usr/bin/codesign', ['--verify', '--strict', '-R=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists', bundleRoot]);
      const subject = detail.text.match(/^Authority=(Developer ID Application: .+)$/mu)?.[1];
      if (!subject) throw new Error('macOS publisher signature is not a verified Developer ID identity');
      const ticket = command('/usr/bin/xcrun', ['stapler', 'validate', bundleRoot]);
      if (ticket.status !== 0 && !/does not have a ticket stapled to it/u.test(ticket.text)) throw new Error(`macOS notarization is unresolved: ${ticket.text.trim()}`);
      observation = { signature: 'developer-id-valid', certificateSubject: subject, notarization: ticket.status === 0 ? 'notarized' : 'absent' };
    }
  }
  return { nativeTrust: classifyMacOSNativeTrustObservation(observation), executionProfile: { launch_mode: 'current-user' } };
}
