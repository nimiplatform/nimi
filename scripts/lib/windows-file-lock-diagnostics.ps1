if (-not ('Nimi.WindowsFileLockDiagnostics' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Nimi
{
    public sealed class WindowsFileLockOwner
    {
        public int ProcessId { get; set; }
        public string ProcessName { get; set; }
        public string ApplicationName { get; set; }
        public string ServiceName { get; set; }
        public string ApplicationType { get; set; }
        public uint TerminalSessionId { get; set; }
        public bool Restartable { get; set; }
    }

    public static class WindowsFileLockDiagnostics
    {
        private const int ErrorSuccess = 0;
        private const int ErrorMoreData = 234;
        private const int MaxListAttempts = 4;

        [StructLayout(LayoutKind.Sequential)]
        private struct RmUniqueProcess
        {
            public int ProcessId;
            public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
        }

        private enum RmAppType
        {
            Unknown = 0,
            MainWindow = 1,
            OtherWindow = 2,
            Service = 3,
            Explorer = 4,
            Console = 5,
            Critical = 1000
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct RmProcessInfo
        {
            public RmUniqueProcess Process;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
            public string ApplicationName;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string ServiceShortName;

            public RmAppType ApplicationType;
            public uint ApplicationStatus;
            public uint TerminalSessionId;

            [MarshalAs(UnmanagedType.Bool)]
            public bool Restartable;
        }

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        private static extern int RmStartSession(
            out uint sessionHandle,
            int sessionFlags,
            StringBuilder sessionKey);

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        private static extern int RmRegisterResources(
            uint sessionHandle,
            uint fileCount,
            string[] fileNames,
            uint applicationCount,
            IntPtr applications,
            uint serviceCount,
            string[] serviceNames);

        [DllImport("rstrtmgr.dll")]
        private static extern int RmGetList(
            uint sessionHandle,
            out uint processInfoNeeded,
            ref uint processInfoCount,
            [In, Out] RmProcessInfo[] processInfo,
            ref uint rebootReasons);

        [DllImport("rstrtmgr.dll")]
        private static extern int RmEndSession(uint sessionHandle);

        public static WindowsFileLockOwner[] GetLockOwners(string path)
        {
            if (String.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("A file path is required.", "path");
            }

            uint sessionHandle;
            StringBuilder sessionKey = new StringBuilder(33);
            int result = RmStartSession(out sessionHandle, 0, sessionKey);
            ThrowOnError(result, "RmStartSession");

            try
            {
                result = RmRegisterResources(
                    sessionHandle,
                    1,
                    new[] { path },
                    0,
                    IntPtr.Zero,
                    0,
                    null);
                ThrowOnError(result, "RmRegisterResources");

                for (int attempt = 0; attempt < MaxListAttempts; attempt++)
                {
                    uint needed = 0;
                    uint count = 0;
                    uint rebootReasons = 0;
                    result = RmGetList(sessionHandle, out needed, ref count, null, ref rebootReasons);
                    if (result == ErrorSuccess)
                    {
                        return new WindowsFileLockOwner[0];
                    }
                    if (result != ErrorMoreData)
                    {
                        ThrowOnError(result, "RmGetList(size)");
                    }
                    if (needed == 0 || needed > Int32.MaxValue)
                    {
                        throw new InvalidOperationException("Restart Manager returned an invalid process count.");
                    }

                    RmProcessInfo[] processInfo = new RmProcessInfo[(int)needed];
                    count = needed;
                    result = RmGetList(
                        sessionHandle,
                        out needed,
                        ref count,
                        processInfo,
                        ref rebootReasons);
                    if (result == ErrorMoreData)
                    {
                        continue;
                    }
                    ThrowOnError(result, "RmGetList(data)");

                    List<WindowsFileLockOwner> owners = new List<WindowsFileLockOwner>();
                    for (int index = 0; index < count; index++)
                    {
                        RmProcessInfo item = processInfo[index];
                        owners.Add(new WindowsFileLockOwner
                        {
                            ProcessId = item.Process.ProcessId,
                            ProcessName = GetProcessName(item.Process.ProcessId),
                            ApplicationName = item.ApplicationName ?? String.Empty,
                            ServiceName = item.ServiceShortName ?? String.Empty,
                            ApplicationType = item.ApplicationType.ToString(),
                            TerminalSessionId = item.TerminalSessionId,
                            Restartable = item.Restartable
                        });
                    }
                    return owners.ToArray();
                }

                throw new InvalidOperationException(
                    "Restart Manager lock ownership changed during every inspection attempt.");
            }
            finally
            {
                RmEndSession(sessionHandle);
            }
        }

        private static string GetProcessName(int processId)
        {
            try
            {
                using (Process process = Process.GetProcessById(processId))
                {
                    return process.ProcessName;
                }
            }
            catch
            {
                return "unavailable";
            }
        }

        private static void ThrowOnError(int result, string operation)
        {
            if (result != ErrorSuccess)
            {
                throw new InvalidOperationException(
                    operation + " failed with Windows error " + result + ".");
            }
        }
    }
}
'@
}

function Get-WindowsFileLockOwners {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $Path
  )

  $resolved = [IO.Path]::GetFullPath($Path)
  return @([Nimi.WindowsFileLockDiagnostics]::GetLockOwners($resolved))
}
