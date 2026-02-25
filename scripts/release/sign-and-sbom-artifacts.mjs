#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const artifactPathsRaw = process.env.NIMI_ARTIFACT_PATHS_JSON;
if (!artifactPathsRaw) {
  process.stderr.write('[sign-and-sbom] NIMI_ARTIFACT_PATHS_JSON is required\n');
  process.exit(1);
}

let artifactPaths;
try {
  artifactPaths = JSON.parse(artifactPathsRaw);
} catch (error) {
  process.stderr.write(`[sign-and-sbom] failed to parse NIMI_ARTIFACT_PATHS_JSON: ${String(error)}\n`);
  process.exit(1);
}

if (!Array.isArray(artifactPaths)) {
  process.stderr.write('[sign-and-sbom] NIMI_ARTIFACT_PATHS_JSON must be a JSON array\n');
  process.exit(1);
}

const normalizedArtifactPaths = [...new Set(
  artifactPaths
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => path.resolve(value)),
)];

if (normalizedArtifactPaths.length === 0) {
  process.stderr.write('[sign-and-sbom] no artifact paths provided\n');
  process.exit(1);
}

for (const artifactPath of normalizedArtifactPaths) {
  if (!existsSync(artifactPath)) {
    process.stderr.write(`[sign-and-sbom] artifact does not exist: ${artifactPath}\n`);
    process.exit(1);
  }
}

const oidcIssuer = process.env.NIMI_SIGN_OIDC_ISSUER || 'https://token.actions.githubusercontent.com';
const identityRegex = process.env.NIMI_SIGN_IDENTITY_REGEX;
if (!identityRegex) {
  process.stderr.write('[sign-and-sbom] NIMI_SIGN_IDENTITY_REGEX is required\n');
  process.exit(1);
}

function runCommand(command, args, label) {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`[sign-and-sbom] ${label} failed with exit code ${String(result.status ?? 'unknown')}`);
  }
}

function signAndVerifyBlob(filePath) {
  const signaturePath = `${filePath}.sig`;
  const certificatePath = `${filePath}.pem`;

  runCommand(
    'cosign',
    [
      'sign-blob',
      '--yes',
      '--output-signature',
      signaturePath,
      '--output-certificate',
      certificatePath,
      filePath,
    ],
    `cosign sign-blob ${path.basename(filePath)}`,
  );

  runCommand(
    'cosign',
    [
      'verify-blob',
      '--certificate',
      certificatePath,
      '--signature',
      signaturePath,
      '--certificate-identity-regexp',
      identityRegex,
      '--certificate-oidc-issuer',
      oidcIssuer,
      filePath,
    ],
    `cosign verify-blob ${path.basename(filePath)}`,
  );

  return [signaturePath, certificatePath];
}

function generateSbom(artifactPath) {
  const sbomPath = `${artifactPath}.spdx.json`;
  const outputDir = path.dirname(sbomPath);
  mkdirSync(outputDir, { recursive: true });

  const scanArgs = ['scan', artifactPath, '-o', `spdx-json=${sbomPath}`];
  const legacyArgs = [artifactPath, '-o', `spdx-json=${sbomPath}`];
  const scanResult = spawnSync('syft', scanArgs, {
    env: process.env,
    stdio: 'inherit',
  });
  if (scanResult.status !== 0) {
    runCommand(
      'syft',
      legacyArgs,
      `syft ${path.basename(artifactPath)}`,
    );
  }

  return sbomPath;
}

const generatedFiles = [];
for (const artifactPath of normalizedArtifactPaths) {
  process.stdout.write(`[sign-and-sbom] processing artifact: ${artifactPath}\n`);

  const sbomPath = generateSbom(artifactPath);
  generatedFiles.push(sbomPath);

  const artifactSignatures = signAndVerifyBlob(artifactPath);
  generatedFiles.push(...artifactSignatures);

  const sbomSignatures = signAndVerifyBlob(sbomPath);
  generatedFiles.push(...sbomSignatures);
}

const outputManifestPath = String(process.env.NIMI_SIGN_OUTPUT_MANIFEST || '').trim();
if (outputManifestPath) {
  const normalizedManifestPath = path.resolve(outputManifestPath);
  mkdirSync(path.dirname(normalizedManifestPath), { recursive: true });
  writeFileSync(normalizedManifestPath, `${JSON.stringify(generatedFiles, null, 2)}\n`, 'utf8');
  process.stdout.write(`[sign-and-sbom] manifest written: ${normalizedManifestPath}\n`);
}

process.stdout.write(
  `[sign-and-sbom] completed: ${normalizedArtifactPaths.length} artifact(s), ${generatedFiles.length} generated file(s)\n`,
);
