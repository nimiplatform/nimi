#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BASELINE_IMAGE_FORMAT,
  BASELINE_IMAGE_PATH,
  BASELINE_RECORD_PATH,
  BASELINE_RECORD_SCHEMA,
  PUBLISHED_ARTIFACT,
  WIRE_SOURCE_TAG,
  breakingFindings,
  buildWireImage,
  classifyFindings,
  extractProtoAtCommit,
  findingKey,
  formatFinding,
  isAncestor,
  readBaselineRecord,
  requireBuf,
  resolveBuf,
  resolveTagCommit,
  sha256,
  verifyMigrationReferences,
  withTempDir,
  writeBaselineRecord,
} from './lib/proto-wire-baseline.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALUE_OPTIONS = ['--tag', '--published', '--adjudication', '--previous-source'];
const USAGE = 'usage: pnpm proto:baseline:refresh -- --tag <component>/v<SemVer> '
  + '--published <npm:|crates:name@version>[,...] --adjudication <text> '
  + '[--previous-source <text>] [--accept-undeclared]';

function parseArgs(argv) {
  const values = {};
  let acceptUndeclared = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (token === '--accept-undeclared') {
      acceptUndeclared = true;
      continue;
    }
    if (!VALUE_OPTIONS.includes(token)) throw new Error(`unknown argument ${token}\n${USAGE}`);
    const value = argv[index + 1];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) throw new Error(`${token} requires a value\n${USAGE}`);
    values[token.slice(2)] = value.trim();
    index += 1;
  }
  if (!WIRE_SOURCE_TAG.test(values.tag || '')) throw new Error(`--tag must name a wire-carrying component release tag\n${USAGE}`);
  const published = String(values.published || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (published.length === 0 || published.some((item) => !PUBLISHED_ARTIFACT.test(item))) {
    throw new Error(`--published must list the registry artifacts published from that tag\n${USAGE}`);
  }
  if (!values.adjudication) throw new Error(`--adjudication must record the review of the difference\n${USAGE}`);
  return { ...values, published, acceptUndeclared };
}

function readPrevious(previousSource) {
  if (fs.existsSync(path.join(repoRoot, BASELINE_RECORD_PATH))) {
    if (previousSource) throw new Error('--previous-source is only for an unrecorded baseline; the record already names its source');
    const record = readBaselineRecord(repoRoot);
    return { declarations: record.declaredBreaking, source: `${record.source.tag} (${record.source.commit})` };
  }
  if (!previousSource) throw new Error(`${BASELINE_RECORD_PATH} does not exist; describe the replaced snapshot with --previous-source`);
  return { declarations: [], source: previousSource };
}

// Refreshing moves the baseline to a newer published wire. Breaks between the
// replaced baseline and that wire already reached users: each carries its
// declaration's migration note or an explicit adjudication, and consumed
// declarations leave the list. Unpublished source can never become the baseline.
function main(argv) {
  const args = parseArgs(argv);
  const commit = resolveTagCommit(repoRoot, args.tag);
  if (!isAncestor(repoRoot, commit, 'HEAD')) throw new Error(`${args.tag} (${commit}) is not contained in the current history`);
  const buf = requireBuf(resolveBuf());
  const previous = readPrevious(args['previous-source']);
  const imagePath = path.join(repoRoot, BASELINE_IMAGE_PATH);
  const previousImage = fs.readFileSync(imagePath);

  const { image, published, current } = withTempDir('nimi-proto-refresh-', (dir) => {
    const protoDir = extractProtoAtCommit(repoRoot, commit, dir);
    const nextImagePath = path.join(dir, 'wire.binpb');
    return {
      image: buildWireImage({ buf, protoDir, outputPath: nextImagePath }),
      published: breakingFindings({ buf, protoDir, againstImage: imagePath }),
      current: breakingFindings({ buf, protoDir: path.join(repoRoot, 'proto'), againstImage: nextImagePath }),
    };
  });

  const declared = new Map(previous.declarations.map((item) => [findingKey(item), item]));
  const undeclaredPublished = published.filter((finding) => !declared.has(findingKey(finding)));
  if (undeclaredPublished.length > 0 && !args.acceptUndeclared) {
    throw new Error(`${args.tag} published breaking changes that were never declared:\n`
      + `${undeclaredPublished.map(formatFinding).join('\n')}\nadjudicate them and rerun with --accept-undeclared`);
  }
  const breakingFromPrevious = published.map((finding) => ({
    rule: finding.rule,
    path: finding.path,
    message: finding.message,
    migration: declared.get(findingKey(finding))?.migration ?? null,
  }));
  const publishedKeys = new Set(published.map(findingKey));
  const remaining = previous.declarations.filter((item) => !publishedKeys.has(findingKey(item)));
  const pending = classifyFindings(current, remaining);
  if (pending.undeclared.length > 0 || pending.stale.length > 0) {
    throw new Error('current source would not pass against the refreshed baseline:\n'
      + `${[...pending.undeclared, ...pending.stale].map(formatFinding).join('\n')}\n`
      + 'declare each remaining break (or remove stale declarations) before refreshing');
  }
  verifyMigrationReferences(repoRoot, [
    ...remaining.map((item) => item.migration),
    ...breakingFromPrevious.map((item) => item.migration).filter(Boolean),
  ]);

  fs.writeFileSync(imagePath, image);
  writeBaselineRecord(repoRoot, {
    schema: BASELINE_RECORD_SCHEMA,
    image: { path: BASELINE_IMAGE_PATH, format: BASELINE_IMAGE_FORMAT, sha256: sha256(image) },
    source: { tag: args.tag, commit, publishedArtifacts: args.published },
    refresh: {
      previous: { source: previous.source, imageSha256: sha256(previousImage) },
      breakingFromPrevious,
      adjudication: args.adjudication,
    },
    declaredBreaking: remaining,
  });
  process.stdout.write(`[proto:baseline:refresh] ${BASELINE_IMAGE_PATH} now holds the wire published at ${args.tag} (${commit}); `
    + `${breakingFromPrevious.length} breaking difference(s) from ${previous.source}; `
    + `${remaining.length} declaration(s) kept. Run pnpm proto:breaking.\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[proto:baseline:refresh] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
