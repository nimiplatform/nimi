#!/usr/bin/env node

// One-time recovery of the authenticated npm PUT that failed in kit/v0.5.0.
// Remove with its workflow after the new package has a trusted publisher.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';

const [tarballPath, provenancePath, npmManifestPath, mode] = process.argv.slice(2);
assert.ok(tarballPath && provenancePath && npmManifestPath);
assert.ok(mode === '--verify-only' || mode === '--publish');
assert.equal(process.argv.length, 6);

const npmRequire = createRequire(npmManifestPath);
const name = '@nimiplatform/kit-protected-local-win32-x64';
const version = '0.5.0';
const repository = 'https://github.com/nimiplatform/nimi';
const sourceCommit = 'bd24f96ddaace66bab43529a08ec1c62f23cb02b';
const tagRef = 'refs/tags/kit/v0.5.0';
const workflowPath = '.github/workflows/release-kit.yml';
const shasum = '232ac9d906aaafbb158c997e313e7ac95ad8246f';
const tarball = readFileSync(tarballPath);
assert.equal(tarball.length, 3971378);
assert.equal(createHash('sha1').update(tarball).digest('hex'), shasum);
const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], { encoding: 'utf8' }));
assert.equal(manifest.name, name);
assert.equal(manifest.version, version);

const bundle = JSON.parse(readFileSync(provenancePath, 'utf8'));
const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64'));
assert.equal(statement._type, 'https://in-toto.io/Statement/v1');
assert.equal(statement.predicateType, 'https://slsa.dev/provenance/v1');
assert.deepEqual(statement.subject, [{
  name: `pkg:npm/%40nimiplatform/kit-protected-local-win32-x64@${version}`,
  digest: { sha512: createHash('sha512').update(tarball).digest('hex') },
}]);
const { buildDefinition, runDetails } = statement.predicate;
assert.deepEqual(buildDefinition.externalParameters.workflow, {
  ref: tagRef, repository, path: workflowPath,
});
assert.deepEqual(buildDefinition.resolvedDependencies, [{
  uri: `git+${repository}@${tagRef}`, digest: { gitCommit: sourceCommit },
}]);
assert.equal(runDetails.metadata.invocationId, `${repository}/actions/runs/33948666681/attempts/1`);
await npmRequire('sigstore').verify(bundle, {
  certificateIdentityURI: `${repository}/${workflowPath}@${tagRef}`,
  certificateIssuer: 'https://token.actions.githubusercontent.com',
});
console.log(`Verified original ${name}@${version}, SHA-1 ${shasum}, source ${sourceCommit}`);

if (mode === '--publish') {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.GITHUB_REPOSITORY, 'nimiplatform/nimi');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.ok(process.env.NODE_AUTH_TOKEN, 'NPM_BOOTSTRAP_TOKEN is required');
  const existing = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { 'cache-control': 'no-cache' },
  });
  if (existing.ok) {
    const metadata = await existing.json();
    assert.equal(metadata.versions?.[version]?.dist?.shasum, shasum, 'Existing package differs; bootstrap cannot replace it');
    console.log('Exact version already exists; configure trusted publishing. No npm mutation.');
  } else {
    assert.equal(existing.status, 404, 'npm absence check failed');
    // The npm CLI merges publishConfig.provenance=true over provenanceFile.
    // Its documented publishing API accepts the original bundle explicitly,
    // verifies its signature and subject again, and never repacks the tarball.
    await npmRequire('libnpmpublish').publish(manifest, tarball, {
      registry: 'https://registry.npmjs.org/',
      access: 'public',
      defaultTag: 'latest',
      npmVersion: npmRequire('./package.json').version,
      provenanceFile: provenancePath,
      '//registry.npmjs.org/:_authToken': process.env.NODE_AUTH_TOKEN,
    });
    console.log(`Published ${name}@${version} with the original tag-run provenance`);
  }
}
