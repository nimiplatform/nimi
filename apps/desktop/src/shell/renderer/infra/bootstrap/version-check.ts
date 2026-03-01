import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

export type VersionCheckResult = {
  ok: boolean;
  daemonVersion: string | null;
  desktopVersion: string;
  severity: 'none' | 'warn' | 'fatal';
  message: string;
};

function parseSemver(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

const DESKTOP_VERSION = '0.1.0';

export function checkDaemonVersion(daemonVersion: string | undefined): VersionCheckResult {
  const desktopVersion = DESKTOP_VERSION;

  if (!daemonVersion) {
    logRendererEvent({
      level: 'warn',
      area: 'version-check',
      message: 'phase:version-check:daemon-version-missing',
      details: { desktopVersion },
    });
    return {
      ok: true,
      daemonVersion: null,
      desktopVersion,
      severity: 'warn',
      message: 'Daemon did not report version; skipping version negotiation',
    };
  }

  const daemonParsed = parseSemver(daemonVersion);
  const desktopParsed = parseSemver(desktopVersion);

  if (!daemonParsed || !desktopParsed) {
    logRendererEvent({
      level: 'warn',
      area: 'version-check',
      message: 'phase:version-check:semver-parse-failed',
      details: { daemonVersion, desktopVersion },
    });
    return {
      ok: true,
      daemonVersion,
      desktopVersion,
      severity: 'warn',
      message: `Cannot parse version strings (daemon=${daemonVersion}, desktop=${desktopVersion})`,
    };
  }

  if (daemonParsed.major !== desktopParsed.major) {
    logRendererEvent({
      level: 'error',
      area: 'version-check',
      message: 'phase:version-check:major-mismatch',
      details: { daemonVersion, desktopVersion },
    });
    return {
      ok: false,
      daemonVersion,
      desktopVersion,
      severity: 'fatal',
      message: `Major version mismatch: daemon=${daemonVersion}, desktop=${desktopVersion}. Bootstrap aborted.`,
    };
  }

  if (daemonParsed.minor !== desktopParsed.minor || daemonParsed.patch !== desktopParsed.patch) {
    logRendererEvent({
      level: 'warn',
      area: 'version-check',
      message: 'phase:version-check:minor-patch-mismatch',
      details: { daemonVersion, desktopVersion },
    });
    return {
      ok: true,
      daemonVersion,
      desktopVersion,
      severity: 'warn',
      message: `Version drift: daemon=${daemonVersion}, desktop=${desktopVersion}`,
    };
  }

  logRendererEvent({
    level: 'info',
    area: 'version-check',
    message: 'phase:version-check:ok',
    details: { daemonVersion, desktopVersion },
  });
  return {
    ok: true,
    daemonVersion,
    desktopVersion,
    severity: 'none',
    message: 'Version match',
  };
}
