import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');

const NON_ADMISSION_TRUTH = Object.freeze({
  registryAdmissionTruth: 'not-generated',
  releaseDescriptorTruth: 'not-generated',
  ordinaryVisibilityTruth: 'not-generated',
  permissionDecisionTruth: 'not-generated',
  signingTruth: 'not-generated',
  notarizationTruth: 'not-generated',
  mirrorLicenseClearanceTruth: 'not-generated',
  supportApprovalTruth: 'not-generated',
  reviewDecisionTruth: 'not-generated',
  productReadinessClaimAllowed: false,
  ordinaryCatalogDiscovery: false,
});

const MISSING_PLATFORM_ADMISSION_FIELDS = Object.freeze([
  'admitted registry row',
  'admitted release descriptor row',
  'public permission requirements set',
  'storage policy ref',
  'capability refs',
  'artifact provenance and signing assurance',
  'platform review decision',
  'support and rollback posture',
  'ordinary or developer visibility decision',
]);

export async function buildZhiyuReleaseEvidence(options = {}) {
  const rootDir = path.resolve(options.rootDir || appRoot);
  const currentRepoRoot = path.resolve(options.repoRoot || repoRoot);
  const evidenceDir = path.resolve(
    options.evidenceDir || path.join(currentRepoRoot, '.nimi', 'local', 'evidence', 'zhiyu', 'pp12'),
  );
  const now = options.now instanceof Date ? options.now : new Date();
  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageJson = readJson(packageJsonPath, 'package.json');

  const files = collectArtifactFiles(rootDir);
  const archive = createTarArchive(files);
  const sha256 = hashBuffer(archive);
  const safePackageName = String(packageJson.name || 'zhiyu')
    .replace(/^@/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-');
  const artifactName = `${safePackageName}-${String(packageJson.version || '0.0.0')}-local-preparation.tar`;
  fs.mkdirSync(evidenceDir, { recursive: true });
  const artifactPath = path.join(evidenceDir, artifactName);
  fs.writeFileSync(artifactPath, archive);

  const installedSize = files.reduce((total, file) => total + file.data.length, 0);
  const evidence = {
    evidenceVersion: 1,
    checkpoint: 'PP12',
    evidenceRole: 'developer-submitted-input',
    admissionTrack: 'preparation',
    generatedBy: '@nimiplatform/zhiyu pack:release-evidence',
    generatedAt: now.toISOString(),
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    buildOutputs: {
      renderer: 'dist',
      electron: 'dist-electron',
    },
    entryRefs: [
      'dist/index.html',
      'dist-electron/main.js',
      'dist-electron/preload.cjs',
      'dist-electron/runtime-auth.js',
    ],
    artifact: {
      role: 'zhiyu-local-build-output',
      path: repoRelative(currentRepoRoot, artifactPath),
      digest_algorithm: 'sha256',
      sha256,
      size: {
        download: String(archive.length),
        installed: String(installedSize),
        user_data: 'not-generated',
        cache: 'not-generated',
        shared_deps: 'not-generated',
      },
      files: files.map((file) => ({
        path: file.name,
        sha256: hashBuffer(file.data),
        size: String(file.data.length),
      })),
    },
    missingPlatformAdmissionFields: [...MISSING_PLATFORM_ADMISSION_FIELDS],
    ...NON_ADMISSION_TRUTH,
  };

  const evidencePath = path.join(evidenceDir, 'zhiyu-release-artifact-evidence.json');
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  return {
    artifactPath,
    evidencePath,
    sha256,
    size: archive.length,
  };
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} missing: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectArtifactFiles(rootDir) {
  const rendererDir = path.join(rootDir, 'dist');
  const electronDir = path.join(rootDir, 'dist-electron');
  if (!fs.existsSync(path.join(rendererDir, 'index.html'))) {
    throw new Error(`renderer build output missing: ${path.join(rendererDir, 'index.html')}`);
  }
  if (!fs.existsSync(path.join(electronDir, 'main.js'))) {
    throw new Error(`Electron build output missing: ${path.join(electronDir, 'main.js')}`);
  }

  const files = [];
  for (const artifactRoot of [rendererDir, electronDir]) {
    for (const filePath of walkFiles(artifactRoot)) {
      files.push({
        name: repoRelative(rootDir, filePath),
        data: fs.readFileSync(filePath),
      });
    }
  }
  files.push({
    name: 'package.json',
    data: fs.readFileSync(path.join(rootDir, 'package.json')),
  });
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function createTarArchive(files) {
  const chunks = [];
  for (const file of files) {
    chunks.push(createTarHeader(file.name, file.data.length));
    chunks.push(file.data);
    chunks.push(Buffer.alloc(paddingLength(file.data.length)));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function createTarHeader(name, size) {
  if (Buffer.byteLength(name) > 100) {
    throw new Error(`artifact path too long for deterministic ustar header: ${name}`);
  }
  const header = Buffer.alloc(512);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, '0');
  writeString(header, 257, 6, 'ustar');
  writeString(header, 263, 2, '00');
  const checksum = header.reduce((sum, value) => sum + value, 0);
  writeChecksum(header, checksum);
  return header;
}

function writeString(header, offset, length, value) {
  header.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
}

function writeOctal(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, '0');
  header.write(text.slice(-length + 1), offset, length - 1, 'ascii');
  header[offset + length - 1] = 0;
}

function writeChecksum(header, checksum) {
  const text = checksum.toString(8).padStart(6, '0');
  header.write(text.slice(-6), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
}

function paddingLength(size) {
  const remainder = size % 512;
  return remainder === 0 ? 0 : 512 - remainder;
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function repoRelative(rootDir, filePath) {
  const relative = path.relative(rootDir, filePath).replaceAll(path.sep, '/');
  return relative || '.';
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  buildZhiyuReleaseEvidence().then((result) => {
    console.log(`[zhiyu] wrote ${repoRelative(repoRoot, result.artifactPath)}`);
    console.log(`[zhiyu] wrote ${repoRelative(repoRoot, result.evidencePath)}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
