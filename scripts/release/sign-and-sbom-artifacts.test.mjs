import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const signingScript = path.join(scriptDir, 'sign-and-sbom-artifacts.mjs');

test('signing entrypoint uses the exact pinned tool paths supplied by its wrapper', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-signing-'));
  const artifactPath = path.join(root, 'runtime.tar.gz');
  const manifestPath = path.join(root, 'generated.json');
  const cosignPath = path.join(root, `exact-cosign${process.platform === 'win32' ? '.exe' : ''}`);
  const syftPath = path.join(root, `exact-syft${process.platform === 'win32' ? '.exe' : ''}`);
  writeFileSync(artifactPath, 'runtime archive');

  // Native command fixtures exercise executable-path selection on every host;
  // their output is test data, not evidence of a valid release signature.
  const fixturePath = path.join(root, 'tool-fixture.go');
  writeFileSync(fixturePath, `package main
import (
  "os"
  "path/filepath"
  "strings"
)
func main() {
  args := os.Args[1:]
  argument := func(key string) string {
    for i, arg := range args { if arg == key && i+1 < len(args) { return args[i+1] } }
    panic("missing argument: " + key)
  }
  write := func(name, content string) {
    if err := os.WriteFile(name, []byte(content), 0600); err != nil { panic(err) }
  }
  if strings.HasPrefix(filepath.Base(os.Args[0]), "exact-syft") {
    if len(args) < 1 || args[0] != "scan" { panic("expected syft scan") }
    write(strings.TrimPrefix(argument("-o"), "spdx-json="), "{\\"spdxVersion\\":\\"SPDX-2.3\\"}")
    return
  }
  if len(args) < 1 { panic("missing command") }
  switch args[0] {
  case "sign-blob":
    write(argument("--output-signature"), "signature")
    write(argument("--output-certificate"), "certificate")
  case "verify-blob":
    for _, key := range []string{"--signature", "--certificate"} {
      if _, err := os.Stat(argument(key)); err != nil { panic(err) }
    }
  default: panic("unexpected command")
  }
}
`);
  const built = spawnSync('go', ['build', '-o', cosignPath, fixturePath], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr || String(built.error));
  copyFileSync(cosignPath, syftPath);

  const result = spawnSync(process.execPath, [signingScript], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: root,
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
