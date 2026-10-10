import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { hashProductFile } from './product-update-manifest.mjs';
import { PRODUCT_UPDATE_POLICY } from '../../config/product-update-policy.mjs';
import { validateWindowsProductIdentity } from '../../config/windows-product-identity.mjs';
import { ProductUpdateError } from '../../config/product-update-contract.mjs';

export { verifyWindowsUnsignedInstaller } from '../../config/windows-product-installer.mjs';

export async function createWindowsProductIdentity({ root, version, sourceRevision, components, privateKey, publicKey = PRODUCT_UPDATE_POLICY.publicKey }) {
  if (!publicKey) throw new ProductUpdateError('UPDATE_TRUST_NOT_CONFIGURED');
  const files = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), info = await lstat(file);
      if (info.isSymbolicLink()) throw new ProductUpdateError('UPDATE_COHORT_INVALID');
      if (info.isDirectory()) { await visit(file); continue; }
      if (!info.isFile()) throw new ProductUpdateError('UPDATE_COHORT_INVALID');
      files[path.relative(root, file).split(path.sep).join('/')] = await hashProductFile(file);
    }
  }
  await visit(root);
  const identity = validateWindowsProductIdentity({ schema: 'nimi-windows-product-identity/v1', releaseId: `nimi/v${version}`, version, channel: 'beta', target: 'windows-amd64', sourceRevision, components, files });
  const payload = Buffer.from(JSON.stringify(identity));
  if (payload.length > PRODUCT_UPDATE_POLICY.maximumMetadataBytes) throw new ProductUpdateError('UPDATE_COHORT_INVALID');
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519' || createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64') !== publicKey) throw new ProductUpdateError('UPDATE_SIGNATURE_INVALID');
  return { identity, envelope: { payload: payload.toString('base64'), signature: sign(null, payload, key).toString('base64') } };
}

export function windowsNsisScript({ root, output, version }) {
  // NSIS is code, not a shell. All interpolation is constrained and dollars
  // and quotes are escaped as NSIS literals. The installer has no URL entry.
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:beta|rc)\.[1-9]\d*)?$/u.test(version)) throw new Error('Invalid version');
  const literal = (v) => {
    if (/[\r\n\0]/u.test(String(v))) throw new Error('Invalid installer path');
    return String(v).replaceAll('$', () => '$$').replaceAll('"', () => '$\\"');
  };
  return `Unicode true
!include "x64.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
Name "Nimi ${version} Beta"
OutFile "${literal(output)}"
RequestExecutionLevel admin
SilentInstall silent
ShowInstDetails show
Section
  StrCpy $7 0
  ; Serialize machine-wide installer/SCM mutation. A cache receipt never
  ; supplies exclusivity or permission to overlap a still active installer.
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Global\\NimiProductInstaller")p.r3'
  IntCmp $3 0 fail
  System::Call 'kernel32::WaitForSingleObject(p r3, i 0)i.r2'
  IntCmp $2 0 locked
  IntCmp $2 128 locked fail fail
  locked:
  \${GetParameters} $4
  \${GetOptions} $4 "/UpdateJob=" $5
  \${GetOptions} $4 "/UpdateHash=" $6
  \${IfNot} \${RunningX64}
    SetErrorLevel 5
    Quit
  \${EndIf}
  SetShellVarContext all
  CreateDirectory "$PROGRAMFILES64\\Nimi"
  System::Call 'kernel32::GetFileAttributesW(w "$PROGRAMFILES64\\Nimi")i.r2'
  IntOp $2 $2 & 0x400
  IntCmp $2 0 +2
  Goto fail
  System::Call 'advapi32::ConvertStringSecurityDescriptorToSecurityDescriptorW(w "O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)", i 1, *p .r1, p 0)i.r2'
  IntCmp $2 0 fail
  System::Call 'advapi32::SetFileSecurityW(w "$PROGRAMFILES64\\Nimi", i 0x80000005, p r1)i.r2'
  System::Call 'kernel32::LocalFree(p r1)'
  IntCmp $2 0 fail
  ClearErrors
  GetTempFileName $0 "$PROGRAMFILES64\\Nimi"
  IfErrors fail
  Delete "$0"
  CreateDirectory "$0"
  IfErrors fail
  StrCpy $7 1
  ; Secure owner and DACL BEFORE extracting executable helper bytes. The
  ; bootstrap directory is administrative and no user-controlled temp path.
  System::Call 'advapi32::ConvertStringSecurityDescriptorToSecurityDescriptorW(w "O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)", i 1, *p .r1, p 0)i.r2'
  IntCmp $2 0 fail
  System::Call 'advapi32::SetFileSecurityW(w r0, i 0x80000005, p r1)i.r2'
  System::Call 'kernel32::LocalFree(p r1)'
  IntCmp $2 0 fail
  SetOutPath "$0"
  File "${literal(path.join(root, 'NimiProductUpdater.exe'))}"
  File "${literal(path.join(root, 'nimi-product-identity.json'))}"
  StrCmp $5 "" standaloneprepare
  ExecWait '"$0\\NimiProductUpdater.exe" --prepare ${version} "$5" $6' $2
  Goto prepared
  standaloneprepare:
  ExecWait '"$0\\NimiProductUpdater.exe" --prepare ${version}' $2
  prepared:
  IntCmp $2 10 currentowner
  IntCmp $2 0 extract installfail installfail
  extract:
  SetOutPath "$PROGRAMFILES64\\Nimi\\Product\\${version}"
  File /r "${literal(root)}\\*"
  currentowner:
  StrCmp $5 "" standaloneinstall
  ExecWait '"$0\\NimiProductUpdater.exe" --install ${version} "$5" $6' $2
  Goto installed
  standaloneinstall:
  ExecWait '"$0\\NimiProductUpdater.exe" --install ${version}' $2
  installed:
  IntCmp $2 0 +2
  Goto installfail
  CreateShortcut "$DESKTOP\\Nimi.lnk" "$PROGRAMFILES64\\Nimi\\Product\\${version}\\Nimi.exe"
  SetErrorLevel 0
  Goto end
  fail:
  SetErrorLevel 5
  Goto end
  installfail:
  SetErrorLevel $2
  end:
  ; Only this attempt's unique bootstrap, on success and failure. Unknown
  ; entries are retained because RMDir is non-recursive.
  StrCmp $7 1 cleanup endmutex
  cleanup:
  SetOutPath "$PROGRAMFILES64\\Nimi"
  Delete "$0\\NimiProductUpdater.exe"
  Delete "$0\\nimi-product-identity.json"
  RMDir "$0"
  endmutex:
  System::Call 'kernel32::ReleaseMutex(p r3)'
  System::Call 'kernel32::CloseHandle(p r3)'
SectionEnd
`;
}
