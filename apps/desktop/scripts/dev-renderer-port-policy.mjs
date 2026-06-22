export function normalizeForMatch(value) {
  return String(value || '').replaceAll('\\', '/').toLowerCase();
}

function quoteCmdArg(value) {
  const raw = String(value);
  if (!/[\s"&|<>^]/.test(raw)) {
    return raw;
  }
  return `"${raw.replaceAll('"', '\\"')}"`;
}

export function planRendererCommand(command, args, { platform }) {
  if (platform !== 'win32') {
    return { command, args };
  }
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', [command, ...args].map(quoteCmdArg).join(' ')],
  };
}

export function isDesktopRendererProcess(commandLine, { desktopRoot, rendererPort }) {
  const normalized = normalizeForMatch(commandLine);
  const normalizedDesktopRoot = normalizeForMatch(desktopRoot);
  return normalized.includes(normalizedDesktopRoot)
    && normalized.includes('vite')
    && normalized.includes(`--port ${rendererPort}`);
}

export function planRendererPortResolution({
  desktopRoot,
  rendererPort,
  processes,
  isRendererReachable,
  forceRestart = false,
}) {
  if (processes.length === 0) {
    return {
      action: 'start',
      pidsToStop: [],
      message: `Port ${rendererPort} is available.`,
    };
  }

  const unrecognizedProcess = processes.find((processInfo) => !isDesktopRendererProcess(
    processInfo.commandLine,
    { desktopRoot, rendererPort },
  ));
  if (unrecognizedProcess) {
    return {
      action: 'fail',
      pidsToStop: [],
      message: `Port ${rendererPort} is already in use by PID ${unrecognizedProcess.pid}. `
        + 'It is not a recognized desktop renderer process, so cleanup was skipped.',
    };
  }

  if (isRendererReachable && !forceRestart) {
    return {
      action: 'reuse',
      pidsToStop: [],
      message: `Reusing active desktop renderer on port ${rendererPort}.`,
    };
  }

  return {
    action: 'restart',
    pidsToStop: processes.map((processInfo) => processInfo.pid),
    message: `Stopping unresponsive desktop renderer on port ${rendererPort}.`,
  };
}
