import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { DESKTOP_VERSION_FALLBACK } from './desktop-version';

export type VersionCheckResult = {
  ok: boolean;
  daemonVersion: string | null;
  desktopVersion: string;
  severity: 'none' | 'warn' | 'fatal';
  message: string;
};

export type VersionCheckOptions = {
  strictExactMatch?: boolean;
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

export function checkDaemonVersion(
  daemonVersion: string | undefined,
  desktopVersionInput: string | undefined = DESKTOP_VERSION_FALLBACK,
  options: VersionCheckOptions = {},
): VersionCheckResult {
  const desktopVersion = String(desktopVersionInput || '').trim() || DESKTOP_VERSION_FALLBACK;
  const strictExactMatch = options.strictExactMatch === true;

  if (!daemonVersion) {
    logRendererEvent({
      level: strictExactMatch ? 'error' : 'warn',
      area: 'version-check',
      message: strictExactMatch
        ? 'phase:version-check:daemon-version-missing-fatal'
        : 'phase:version-check:daemon-version-missing',
      details: { desktopVersion, strictExactMatch },
    });
    return {
      ok: !strictExactMatch,
      daemonVersion: null,
      desktopVersion,
      severity: strictExactMatch ? 'fatal' : 'warn',
      message: strictExactMatch
        ? `Daemon did not report version; packaged desktop requires exact runtime match for ${desktopVersion}`
        : 'Daemon did not report version; skipping version negotiation',
    };
  }

  const daemonParsed = parseSemver(daemonVersion);
  const desktopParsed = parseSemver(desktopVersion);

  if (!daemonParsed || !desktopParsed) {
    logRendererEvent({
      level: strictExactMatch ? 'error' : 'warn',
      area: 'version-check',
      message: strictExactMatch
        ? 'phase:version-check:semver-parse-failed-fatal'
        : 'phase:version-check:semver-parse-failed',
      details: { daemonVersion, desktopVersion, strictExactMatch },
    });
    return {
      ok: !strictExactMatch,
      daemonVersion,
      desktopVersion,
      severity: strictExactMatch ? 'fatal' : 'warn',
      message: strictExactMatch
        ? `Packaged desktop requires exact semver match (daemon=${daemonVersion}, desktop=${desktopVersion})`
        : `Cannot parse version strings (daemon=${daemonVersion}, desktop=${desktopVersion})`,
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
      level: strictExactMatch ? 'error' : 'warn',
      area: 'version-check',
      message: strictExactMatch
        ? 'phase:version-check:exact-mismatch'
        : 'phase:version-check:minor-patch-mismatch',
      details: { daemonVersion, desktopVersion, strictExactMatch },
    });
    return {
      ok: !strictExactMatch,
      daemonVersion,
      desktopVersion,
      severity: strictExactMatch ? 'fatal' : 'warn',
      message: strictExactMatch
        ? `Packaged desktop requires exact version match: daemon=${daemonVersion}, desktop=${desktopVersion}. Bootstrap aborted.`
        : `Version drift: daemon=${daemonVersion}, desktop=${desktopVersion}`,
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
