import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SDK_PACKAGE_JSON_RELATIVE_PATH } from './constants.mjs';

function semverMatch(version) {
  return /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
}

function bumpPatch(version) {
  const matched = semverMatch(version);
  if (!matched) {
    throw new Error(
      `Unsupported version format: ${version}. Expected semver like 0.1.0 or 0.1.0-beta.1`,
    );
  }
  const major = Number.parseInt(matched[1], 10);
  const minor = Number.parseInt(matched[2], 10);
  const patch = Number.parseInt(matched[3], 10) + 1;
  return `${major}.${minor}.${patch}`;
}

function readSdkPackageJson(repoRoot) {
  const packagePath = path.join(repoRoot, SDK_PACKAGE_JSON_RELATIVE_PATH);
  const content = readFileSync(packagePath, 'utf8');
  return {
    packagePath,
    parsed: JSON.parse(content),
  };
}

function writeSdkPackageJson(packagePath, parsed) {
  writeFileSync(packagePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

function ensureValidSemver(version) {
  if (!semverMatch(version)) {
    throw new Error(
      `Invalid --set-version value: ${version}. Expected semver like 0.1.1 or 0.1.1-beta.1`,
    );
  }
}

export function maybeUpdateRealmVersion(repoRoot, options, generatedChanged) {
  const { packagePath, parsed } = readSdkPackageJson(repoRoot);
  const currentVersion = String(parsed.version || '').trim();
  if (!currentVersion) {
    throw new Error(`${SDK_PACKAGE_JSON_RELATIVE_PATH} is missing version field`);
  }

  if (options.setVersion) {
    ensureValidSemver(options.setVersion);
    if (options.setVersion !== currentVersion) {
      parsed.version = options.setVersion;
      writeSdkPackageJson(packagePath, parsed);
      process.stdout.write(
        `[generate:realm-sdk] set @nimiplatform/sdk version: ${currentVersion} -> ${options.setVersion}\n`,
      );
    } else {
      process.stdout.write(
        `[generate:realm-sdk] @nimiplatform/sdk version unchanged: ${currentVersion}\n`,
      );
    }
    return;
  }

  if (options.skipVersionBump) {
    process.stdout.write('[generate:realm-sdk] skip version bump by --skip-version-bump\n');
    return;
  }

  if (!generatedChanged) {
    process.stdout.write('[generate:realm-sdk] generated SDK unchanged, skip version bump\n');
    return;
  }

  const nextVersion = bumpPatch(currentVersion);
  parsed.version = nextVersion;
  writeSdkPackageJson(packagePath, parsed);
  process.stdout.write(
    `[generate:realm-sdk] bumped @nimiplatform/sdk version: ${currentVersion} -> ${nextVersion}\n`,
  );
}
