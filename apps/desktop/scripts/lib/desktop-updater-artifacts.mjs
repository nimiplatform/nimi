import fs from 'node:fs';
import path from 'node:path';

export function normalizeArtifactPaths(artifacts) {
  if (!Array.isArray(artifacts)) {
    return [];
  }

  return [...new Set(
    artifacts
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .map((value) => path.resolve(value)),
  )];
}

export function matchesExpectedBundle(artifacts, expectedBundle) {
  if (expectedBundle === 'appimage') {
    return artifacts.some((filePath) => path.basename(filePath).includes('.AppImage'));
  }

  if (expectedBundle === 'app') {
    return artifacts.some((filePath) => path.basename(filePath).includes('.app.tar.gz'));
  }

  if (expectedBundle === 'nsis') {
    return artifacts.some((filePath) => {
      const base = path.basename(filePath).toLowerCase();
      return base.endsWith('.exe') && base.includes('setup');
    });
  }

  return true;
}

export function collectDesktopUpdaterArtifactViolations({ artifacts, expectedBundle }) {
  const normalizedArtifacts = normalizeArtifactPaths(artifacts);
  const errors = [];

  if (normalizedArtifacts.length === 0) {
    errors.push('tauri-action did not report any artifact paths');
    return errors;
  }

  for (const artifactPath of normalizedArtifacts) {
    if (!fs.existsSync(artifactPath)) {
      errors.push(`artifact does not exist: ${artifactPath}`);
    }
  }

  const latestJsonPath = normalizedArtifacts.find((filePath) => path.basename(filePath) === 'latest.json');
  if (!latestJsonPath) {
    errors.push('latest.json is missing from tauri artifacts');
  }

  const signatureArtifacts = normalizedArtifacts.filter((filePath) => filePath.endsWith('.sig'));
  if (signatureArtifacts.length === 0) {
    errors.push('no updater signature artifacts (.sig) were produced');
  }

  if (!matchesExpectedBundle(normalizedArtifacts, expectedBundle)) {
    errors.push(`expected updater bundle type ${expectedBundle} was not found in tauri artifacts`);
  }

  if (!latestJsonPath) {
    return errors;
  }

  if (!fs.existsSync(latestJsonPath)) {
    errors.push(`latest.json reported by tauri-action does not exist: ${latestJsonPath}`);
    return errors;
  }

  let latest;
  try {
    latest = JSON.parse(fs.readFileSync(latestJsonPath, 'utf8'));
  } catch (error) {
    errors.push(`latest.json is not valid JSON: ${String(error)}`);
    return errors;
  }

  if (!latest.version || String(latest.version).trim().length === 0) {
    errors.push('latest.json version is empty');
  }

  const platforms = latest.platforms && typeof latest.platforms === 'object'
    ? Object.entries(latest.platforms)
    : [];
  if (platforms.length === 0) {
    errors.push('latest.json platforms is empty');
  }

  for (const [platform, payload] of platforms) {
    const record = payload && typeof payload === 'object' ? payload : null;
    if (!record) {
      errors.push(`latest.json platform ${platform} payload is invalid`);
      continue;
    }
    if (!record.url || String(record.url).trim().length === 0) {
      errors.push(`latest.json platform ${platform} url is empty`);
    }
    if (!record.signature || String(record.signature).trim().length === 0) {
      errors.push(`latest.json platform ${platform} signature is empty`);
    }
  }

  return errors;
}
