import fs from 'node:fs';
import path from 'node:path';

import {
  collectDesktopReleaseSyncViolations,
  readJson,
} from './desktop-release-sync.mjs';
import {
  collectDesktopUpdaterArtifactViolations,
  normalizeArtifactPaths,
} from './desktop-updater-artifacts.mjs';

export function buildDesktopReleaseEvidence(input) {
  const desktopRoot = path.resolve(String(input.desktopRoot));
  const expectedVersion = String(input.expectedVersion || '').trim();
  const expectedBundle = String(input.expectedBundle || '').trim();
  const platform = String(input.platform || '').trim();
  const workflowRef = String(input.workflowRef || '').trim();
  const commit = String(input.commit || '').trim();
  const artifactPaths = normalizeArtifactPaths(input.artifactPaths);

  if (!expectedVersion) {
    throw new Error('expectedVersion is required');
  }
  if (!platform) {
    throw new Error('platform is required');
  }

  const tauriRoot = path.join(desktopRoot, 'src-tauri');
  const resourcesRoot = path.join(tauriRoot, 'resources');
  const releaseManifestPath = path.join(resourcesRoot, 'desktop-release-manifest.json');
  const runtimeManifestPath = path.join(resourcesRoot, 'runtime', 'manifest.json');

  const releaseManifest = readJson(releaseManifestPath);
  const runtimeManifest = readJson(runtimeManifestPath);
  const releaseSyncViolations = collectDesktopReleaseSyncViolations(desktopRoot, expectedVersion);
  const updaterViolations = collectDesktopUpdaterArtifactViolations({
    artifacts: artifactPaths,
    expectedBundle,
  });

  const latestJsonPath = artifactPaths.find((filePath) => path.basename(filePath) === 'latest.json') || null;
  const signatureArtifacts = artifactPaths.filter((filePath) => filePath.endsWith('.sig'));

  return {
    generatedAt: new Date().toISOString(),
    expectedVersion,
    expectedBundle,
    platform,
    workflowRef,
    commit,
    ok: releaseSyncViolations.length === 0 && updaterViolations.length === 0,
    releaseManifest,
    runtimeManifest,
    latestJsonPath,
    signatureArtifactCount: signatureArtifacts.length,
    artifactPaths,
    releaseSyncViolations,
    updaterViolations,
  };
}

export function renderDesktopReleaseEvidenceMarkdown(evidence) {
  const lines = [
    '# Desktop Release Evidence',
    '',
    `- Generated at: ${evidence.generatedAt}`,
    `- Platform: ${evidence.platform}`,
    `- Expected version: ${evidence.expectedVersion}`,
    `- Expected bundle: ${evidence.expectedBundle || '-'}`,
    `- Workflow ref: ${evidence.workflowRef || '-'}`,
    `- Commit: ${evidence.commit || '-'}`,
    `- Verdict: ${evidence.ok ? 'PASS' : 'FAIL'}`,
    '',
    '## Release Manifest',
    '',
    `- Desktop version: ${evidence.releaseManifest.desktopVersion}`,
    `- Runtime version: ${evidence.releaseManifest.runtimeVersion}`,
    `- Runtime archive path: ${evidence.releaseManifest.runtimeArchivePath}`,
    `- Runtime sha256: ${evidence.releaseManifest.runtimeSha256}`,
    '',
    '## Runtime Manifest',
    '',
    `- Platform key: ${evidence.runtimeManifest.platform}`,
    `- Archive path: ${evidence.runtimeManifest.archivePath}`,
    `- Binary path: ${evidence.runtimeManifest.binaryPath}`,
    '',
    '## Updater Artifacts',
    '',
    `- latest.json: ${evidence.latestJsonPath || '-'}`,
    `- Signature files: ${evidence.signatureArtifactCount}`,
    '',
    '## Violations',
    '',
  ];

  if (evidence.releaseSyncViolations.length === 0 && evidence.updaterViolations.length === 0) {
    lines.push('- None');
  } else {
    for (const violation of evidence.releaseSyncViolations) {
      lines.push(`- release-sync: ${violation}`);
    }
    for (const violation of evidence.updaterViolations) {
      lines.push(`- updater: ${violation}`);
    }
  }

  lines.push('', '## Artifact Paths', '');
  for (const artifactPath of evidence.artifactPaths) {
    lines.push(`- ${artifactPath}`);
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function writeDesktopReleaseEvidence(outputJsonPath, outputMarkdownPath, evidence) {
  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputMarkdownPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  fs.writeFileSync(outputMarkdownPath, renderDesktopReleaseEvidenceMarkdown(evidence), 'utf8');
}
