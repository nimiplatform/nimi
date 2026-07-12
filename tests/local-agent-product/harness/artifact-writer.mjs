import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { scanArtifactFiles } from './privacy-scan.mjs';

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-|-$/gu, '') || 'artifact';
}

export function persistResultEvidence({ outputDir, result, artifactInputs }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const evidenceDir = path.join(outputDir, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const seenIds = new Set();
  const artifacts = artifactInputs.map((input, index) => {
    const artifactId = String(input?.artifactId || '').trim();
    if (!artifactId || seenIds.has(artifactId)) throw new Error(`invalid or duplicate artifact id ${artifactId || '<empty>'}`);
    seenIds.add(artifactId);
    const source = path.resolve(input.file);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`missing artifact input ${source}`);
    const target = path.join(evidenceDir, `${String(index + 1).padStart(3, '0')}-${safeName(artifactId)}${path.extname(source) && !safeName(artifactId).endsWith(path.extname(source)) ? path.extname(source) : ''}`);
    fs.copyFileSync(source, target);
    return {
      artifactId,
      path: target,
      sha256: sha256(target),
      bytes: fs.statSync(target).size,
      privacyClass: input.privacyClass || 'safe_evidence',
    };
  });
  const resultPath = path.join(outputDir, 'result.json');
  const normalized = { ...result, artifacts, privacy: { ok: true, findings: [] } };
  fs.writeFileSync(resultPath, `${JSON.stringify(normalized, null, 2)}\n`);
  const scannedFiles = [resultPath, ...artifacts.map((artifact) => artifact.path)];
  const privacy = scanArtifactFiles(scannedFiles);
  normalized.privacy = privacy;
  fs.writeFileSync(resultPath, `${JSON.stringify(normalized, null, 2)}\n`);
  if (!privacy.ok) throw new Error(`artifact privacy scan failed: ${privacy.findings.join(', ')}`);
  const manifest = {
    schemaVersion: 'nimi.local-agent-product-artifact-manifest/v2',
    resultIdentity: normalized.journeyTrialId || normalized.suiteTrialId,
    privacy,
    files: [resultPath, ...artifacts.map((artifact) => artifact.path)].map((file) => ({
      path: path.relative(outputDir, file),
      sha256: sha256(file),
      bytes: fs.statSync(file).size,
      privacyClass: 'safe_evidence',
    })),
  };
  const manifestPath = path.join(outputDir, 'artifact-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { result: normalized, resultPath, manifestPath, manifest };
}
