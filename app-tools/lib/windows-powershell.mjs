// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-024b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';

export function windowsPowerShellEnv(overrides = {}, baseEnv = process.env) {
  const env = { ...baseEnv, ...overrides };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'psmodulepath') delete env[key];
  }
  return env;
}

const WINDOWS_PE_SIGNATURE = 0x00004550;
const WINDOWS_PE_MACHINE_AMD64 = 0x8664;
const WINDOWS_PE32_PLUS_MAGIC = 0x020b;
const WINDOWS_PE_CHARACTERISTIC_EXECUTABLE_IMAGE = 0x0002;
const WINDOWS_PE_CHARACTERISTIC_SYSTEM = 0x1000;
const WINDOWS_PE_CHARACTERISTIC_DLL = 0x2000;
const WINDOWS_PE_SUBSYSTEM_GUI = 2;
const WINDOWS_PE_SUBSYSTEM_CUI = 3;

function readExact(fd, length, position, label) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const read = readSync(fd, buffer, offset, length - offset, position + offset);
    if (read === 0) throw new Error(`Windows executable PE verification failed: truncated ${label}`);
    offset += read;
  }
  return buffer;
}

function validateWindowsExecutablePeHeader(executablePath) {
  const fd = openSync(executablePath, 'r');
  try {
    const size = fstatSync(fd).size;
    if (!Number.isSafeInteger(size) || size < 64) {
      throw new Error('Windows executable PE verification failed: truncated DOS header');
    }
    const dosHeader = readExact(fd, 64, 0, 'DOS header');
    if (dosHeader[0] !== 0x4d || dosHeader[1] !== 0x5a) {
      throw new Error('Windows executable PE verification failed: DOS signature must be MZ');
    }
    const peOffset = dosHeader.readUInt32LE(0x3c);
    if (peOffset < 64 || peOffset > size - 24) {
      throw new Error('Windows executable PE verification failed: PE header offset is out of bounds');
    }
    const coffHeader = readExact(fd, 24, peOffset, 'PE and COFF header');
    if (coffHeader.readUInt32LE(0) !== WINDOWS_PE_SIGNATURE) {
      throw new Error('Windows executable PE verification failed: PE signature is invalid');
    }
    const machine = coffHeader.readUInt16LE(4);
    if (machine !== WINDOWS_PE_MACHINE_AMD64) {
      throw new Error(`Windows executable PE verification failed: machine must be AMD64 (0x8664), observed 0x${machine.toString(16).padStart(4, '0')}`);
    }
    const sectionCount = coffHeader.readUInt16LE(6);
    const optionalHeaderSize = coffHeader.readUInt16LE(20);
    const characteristics = coffHeader.readUInt16LE(22);
    const optionalHeaderOffset = peOffset + 24;
    const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
    const sectionTableEnd = sectionTableOffset + sectionCount * 40;
    if (sectionCount === 0 || optionalHeaderSize < 70 || sectionTableEnd > size) {
      throw new Error('Windows executable PE verification failed: optional header or section table is out of bounds');
    }
    const optionalHeader = readExact(fd, 70, optionalHeaderOffset, 'PE optional header');
    const magic = optionalHeader.readUInt16LE(0);
    if (magic !== WINDOWS_PE32_PLUS_MAGIC) {
      throw new Error(`Windows executable PE verification failed: optional header must be PE32+ (0x020b), observed 0x${magic.toString(16).padStart(4, '0')}`);
    }
    if ((characteristics & WINDOWS_PE_CHARACTERISTIC_EXECUTABLE_IMAGE) === 0) {
      throw new Error('Windows executable PE verification failed: IMAGE_FILE_EXECUTABLE_IMAGE is required');
    }
    if ((characteristics & WINDOWS_PE_CHARACTERISTIC_DLL) !== 0) {
      throw new Error('Windows executable PE verification failed: IMAGE_FILE_DLL is not a process Runtime entry');
    }
    if ((characteristics & WINDOWS_PE_CHARACTERISTIC_SYSTEM) !== 0) {
      throw new Error('Windows executable PE verification failed: IMAGE_FILE_SYSTEM is not a user-mode Runtime entry');
    }
    const subsystem = optionalHeader.readUInt16LE(68);
    if (subsystem !== WINDOWS_PE_SUBSYSTEM_GUI && subsystem !== WINDOWS_PE_SUBSYSTEM_CUI) {
      throw new Error(`Windows executable PE verification failed: subsystem must be WINDOWS_GUI or WINDOWS_CUI, observed ${subsystem}`);
    }
  } finally {
    closeSync(fd);
  }
}

const WINDOWS_EXECUTABLE_FACTS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class NimiWindowsExecutionProfile
{
    private const uint ResourceNameValid = 0x00000008;
    private const uint RunlevelInformationInActivationContext = 5;
    private static readonly IntPtr InvalidHandleValue = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ActivationContext
    {
        public uint Size;
        public uint Flags;
        [MarshalAs(UnmanagedType.LPWStr)] public string Source;
        public ushort ProcessorArchitecture;
        public ushort LanguageId;
        [MarshalAs(UnmanagedType.LPWStr)] public string AssemblyDirectory;
        public IntPtr ResourceName;
        [MarshalAs(UnmanagedType.LPWStr)] public string ApplicationName;
        public IntPtr Module;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RunLevelInformation
    {
        public uint Flags;
        public uint RunLevel;
        public uint UiAccess;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateActCtxW(ref ActivationContext activationContext);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void ReleaseActCtx(IntPtr activationContext);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryActCtxW(
        uint flags,
        IntPtr activationContext,
        IntPtr subInstance,
        uint informationClass,
        ref RunLevelInformation buffer,
        UIntPtr bufferSize,
        out UIntPtr writtenOrRequired);

    public static RunLevelInformation Read(string executablePath)
    {
        ActivationContext input = new ActivationContext();
        input.Size = checked((uint)Marshal.SizeOf(typeof(ActivationContext)));
        input.Flags = ResourceNameValid;
        input.Source = executablePath;
        input.ResourceName = new IntPtr(1);
        IntPtr activationContext = CreateActCtxW(ref input);
        if (activationContext == InvalidHandleValue)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to create an activation context from the embedded process manifest");
        }

        try
        {
            RunLevelInformation output = new RunLevelInformation();
            UIntPtr writtenOrRequired;
            bool queried = QueryActCtxW(
                0,
                activationContext,
                IntPtr.Zero,
                RunlevelInformationInActivationContext,
                ref output,
                (UIntPtr)Marshal.SizeOf(typeof(RunLevelInformation)),
                out writtenOrRequired);
            if (!queried)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to query the Windows activation-context run level");
            }
            return output;
        }
        finally
        {
            ReleaseActCtx(activationContext);
        }
    }
}
'@

$runLevel = [NimiWindowsExecutionProfile]::Read($env:NIMI_APP_EXECUTABLE_PATH)
if ($runLevel.Flags -ne 0 -or $runLevel.RunLevel -ne 1 -or $runLevel.UiAccess -ne 0) {
  throw ('Windows executable must resolve requestedExecutionLevel=asInvoker and uiAccess=false; observed flags=' + $runLevel.Flags + ', runLevel=' + $runLevel.RunLevel + ', uiAccess=' + $runLevel.UiAccess)
}

$signature = Get-AuthenticodeSignature -LiteralPath $env:NIMI_APP_EXECUTABLE_PATH
$certificateSubject = $null
if ($null -ne $signature.SignerCertificate) {
  $certificateSubject = [string]$signature.SignerCertificate.Subject
}
[pscustomobject]@{
  authenticode = [pscustomobject]@{
    status = [string]$signature.Status
    signature_type = [string]$signature.SignatureType
    certificate_subject = $certificateSubject
  }
  execution_profile = [pscustomobject]@{
    requested_execution_level = 'asInvoker'
    ui_access = $false
  }
} | ConvertTo-Json -Compress -Depth 4
`;

export function observeWindowsExecutableFacts(executablePath) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Windows executable observation must run on windows-x86_64');
  }
  if (typeof executablePath !== 'string' || !path.isAbsolute(executablePath)) {
    throw new Error('Windows executable observation requires an absolute path');
  }
  if (!existsSync(executablePath)) {
    throw new Error(`Windows executable observation target is missing: ${executablePath}`);
  }
  const target = lstatSync(executablePath);
  if (!target.isFile() || target.isSymbolicLink()) {
    throw new Error(`Windows executable observation target must be a direct regular file: ${executablePath}`);
  }
  validateWindowsExecutablePeHeader(executablePath);

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_EXECUTABLE_FACTS_SCRIPT,
  ], {
    encoding: 'utf8',
    env: windowsPowerShellEnv({ NIMI_APP_EXECUTABLE_PATH: executablePath }),
  });
  if (result.status !== 0) {
    const detail = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`Windows executable profile verification failed${detail ? `: ${detail}` : ''}`);
  }

  let observed;
  try {
    observed = JSON.parse(String(result.stdout || '').trim());
  } catch (error) {
    throw new Error(`Windows executable observation returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const status = observed?.authenticode?.status;
  const signatureType = observed?.authenticode?.signature_type;
  const certificateSubject = observed?.authenticode?.certificate_subject;
  if (typeof status !== 'string' || !status || status !== status.trim()) {
    throw new Error('Windows executable observation returned an invalid Authenticode status');
  }
  if (typeof signatureType !== 'string' || !signatureType || signatureType !== signatureType.trim()) {
    throw new Error('Windows executable observation returned an invalid signature type');
  }
  if (certificateSubject !== null && (
    typeof certificateSubject !== 'string'
    || !certificateSubject
    || certificateSubject !== certificateSubject.trim()
  )) {
    throw new Error('Windows executable observation returned an invalid certificate subject');
  }
  if (
    observed?.execution_profile?.requested_execution_level !== 'asInvoker'
    || observed?.execution_profile?.ui_access !== false
  ) {
    throw new Error('Windows executable observation returned an invalid execution profile');
  }
  return Object.freeze({
    authenticode: Object.freeze({
      status,
      signature_type: signatureType,
      certificate_subject: certificateSubject,
    }),
    execution_profile: Object.freeze({ requested_execution_level: 'asInvoker', ui_access: false }),
  });
}
