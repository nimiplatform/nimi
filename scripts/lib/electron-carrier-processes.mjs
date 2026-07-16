const PROCESS_PATH_SEPARATOR = /[\\/]+/gu;

export function findBlockingElectronCarriers(rows, repoRoot) {
  const root = normalizedWindowsPath(repoRoot);
  const electronRuntimeRoot = `${root}\\.nimi\\local\\electron-desktop-runtime\\`;
  const zhiyuElectron = `${root}\\apps\\zhiyu\\node_modules\\electron\\dist\\electron.exe`;
  const zhiyuRoot = `${root}\\apps\\zhiyu\\`;
  return normalizedRows(rows).filter((row) => {
    const executable = normalizedWindowsPath(row.executablePath);
    const processName = String(row.name || '').trim().toLowerCase();
    const commandLine = normalizedWindowsPath(row.commandLine);
    const repositoryExecutable = executable.startsWith(`${root}\\`);
    const zhiyuCheckpointRenderer = commandLine.includes(zhiyuRoot)
      && commandLine.includes('vite')
      && /(?:^|\s)--port(?:=|\s+)1472(?:\s|$)/u.test(commandLine);
    return executable.startsWith(electronRuntimeRoot)
      || executable === zhiyuElectron
      || (processName === 'electron.exe' && repositoryExecutable)
      || zhiyuCheckpointRenderer;
  });
}

export function normalizedProcessRows(rows) {
  return normalizedRows(rows);
}

function normalizedRows(rows) {
  const values = Array.isArray(rows) ? rows : rows ? [rows] : [];
  return values.map((row) => ({
    processId: Number(row?.ProcessId ?? row?.processId ?? 0),
    parentProcessId: Number(row?.ParentProcessId ?? row?.parentProcessId ?? 0),
    name: String(row?.Name ?? row?.name ?? ''),
    executablePath: String(row?.ExecutablePath ?? row?.executablePath ?? ''),
    commandLine: String(row?.CommandLine ?? row?.commandLine ?? ''),
  }));
}

function normalizedWindowsPath(value) {
  return String(value || '').trim().replace(PROCESS_PATH_SEPARATOR, '\\').replace(/\\$/u, '').toLowerCase();
}
