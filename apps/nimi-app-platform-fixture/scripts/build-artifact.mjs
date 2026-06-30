import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const artifactName = 'nimi-app-platform-fixture-0.1.0-sandbox.tar';
const artifactDirName = 'dist-artifacts';

export async function buildArtifact(options = {}) {
  const rootDir = path.resolve(options.rootDir || packageRoot);
  const distDir = path.join(rootDir, 'dist');
  const manifestPath = path.join(rootDir, 'nimi-app.manifest.json');
  if (!fs.existsSync(distDir)) {
    throw new Error(`fixture dist directory is missing: ${distDir}`);
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`fixture manifest is missing: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = collectArtifactFiles(rootDir, distDir, manifestPath);
  const archive = createTarArchive(files);
  const sha256 = hashBuffer(archive);
  const artifactDir = path.join(rootDir, artifactDirName);
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, artifactName);
  fs.writeFileSync(artifactPath, archive);

  const installedSize = files.reduce((total, file) => total + file.data.length, 0);
  const evidence = {
    schemaVersion: 1,
    admissionTrack: 'admission-sandbox-ci',
    productReadinessClaimAllowed: false,
    ordinaryCatalogDiscovery: false,
    generatedAt: '1970-01-01T00:00:00Z',
    manifest,
    artifact: {
      path: path.relative(rootDir, artifactPath).replaceAll(path.sep, '/'),
      digest_algorithm: 'sha256',
      sha256,
      size: {
        download: String(archive.length),
        installed: String(installedSize),
        user_data: '0',
        cache: '0',
        shared_deps: '0',
      },
      files: files.map((file) => ({
        path: file.name,
        sha256: hashBuffer(file.data),
        size: String(file.data.length),
      })),
    },
  };
  const evidencePath = path.join(artifactDir, 'descriptor-evidence.json');
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  return {
    artifactPath,
    evidencePath,
    sha256,
    size: archive.length,
  };
}

function collectArtifactFiles(rootDir, distDir, manifestPath) {
  const files = [];
  for (const filePath of walkFiles(distDir)) {
    files.push({
      name: path.relative(rootDir, filePath).replaceAll(path.sep, '/'),
      data: fs.readFileSync(filePath),
    });
  }
  files.push({
    name: path.relative(rootDir, manifestPath).replaceAll(path.sep, '/'),
    data: fs.readFileSync(manifestPath),
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

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  buildArtifact().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
