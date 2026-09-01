import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const signingScript = path.join(scriptDir, 'sign-and-sbom-artifacts.mjs');

function executable(filePath, source) {
  writeFileSync(filePath, source, 'utf8');
  chmodSync(filePath, 0o755);
}

test('signing entrypoint uses the exact pinned tool paths supplied by its wrapper', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-signing-'));
  const artifactPath = path.join(root, 'runtime.tar.gz');
  const manifestPath = path.join(root, 'generated.json');
  const cosignPath = path.join(root, 'exact-cosign');
  const syftPath = path.join(root, 'exact-syft');
  writeFileSync(artifactPath, 'runtime archive');

  executable(cosignPath, `#!/bin/sh
set -eu
command="$1"
shift
if [ "$command" = "sign-blob" ]; then
  signature=""
  certificate=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --output-signature) signature="$2"; shift 2 ;;
      --output-certificate) certificate="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  printf 'signature' > "$signature"
  printf 'certificate' > "$certificate"
  exit 0
fi
if [ "$command" = "verify-blob" ]; then
  exit 0
fi
exit 91
`);
  executable(syftPath, `#!/bin/sh
set -eu
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    *) shift ;;
  esac
done
output="${'${output#spdx-json=}'}"
printf '{"spdxVersion":"SPDX-2.3"}\n' > "$output"
`);

  const result = spawnSync(process.execPath, [signingScript], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: '/usr/bin:/bin',
      NIMI_ARTIFACT_PATHS_JSON: JSON.stringify([artifactPath]),
      NIMI_SIGN_IDENTITY_REGEX: 'test-identity',
      NIMI_SIGN_OUTPUT_MANIFEST: manifestPath,
      NIMI_COSIGN_BIN: cosignPath,
      NIMI_SYFT_BIN: syftPath,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const generated = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(generated.length, 5);
  for (const filePath of generated) assert.equal(existsSync(filePath), true, filePath);
});
