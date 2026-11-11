import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { detectCiScope } from './detect-ci-scope.mjs';
import { checkDocsSources, selectDocsReview } from './lib/docs-source.mjs';
import { selectCiScope } from './lib/ci-scope.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-doc-sources-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('.nimi/spec/runtime/sample.authority.yaml', 'format: nimicoding.authority/v2\nunits:\n  - id: rule.example.active\n    kind: rule\n  - id: rule.example.retired\n    kind: rule\n    lifecycle: removed\n');
  write('sdks/package.json', '{}');
  write('kit/auth/android/Plugin.java', '// native owner');
  const metadata = { authority: ['rule.example.active'], sources: ['sdks/package.json', 'kit/auth/android'] };
  const page = meta => `<!-- nimi-docs: ${JSON.stringify(meta)} -->\n# Guide\n\n## Source Basis\n\n- [Source](https://github.com/nimiplatform/nimi/blob/main/sdks/package.json)\n`;
  write('docs/start/web.md', page(metadata)); write('docs/zh/start/web.md', page(metadata));
  return { root, write, page, metadata };
}

test('deleted Source Basis target reports the reader page even without metadata', t => {
  const f = fixture(t);
  f.write('docs/voice.md', '# Voice\n\n## Source Basis\n\n- [Source](https://github.com/nimiplatform/nimi/blob/main/deleted/voice.tsx)\n');
  assert.deepEqual(checkDocsSources(f.root).errors, ['docs/voice.md:5: missing source deleted/voice.tsx']);
});
test('missing and retired authority links fail with an exact page and ID', t => {
  const f = fixture(t);
  for (const id of ['rule.example.missing', 'rule.example.retired']) {
    f.write('docs/start/web.md', f.page({ ...f.metadata, authority: [id] }));
    assert.throws(() => checkDocsSources(f.root), error => error.message.includes('docs/start/web.md') && error.message.includes(id));
  }
});
test('public export, native source and authority-only changes select both languages, unrelated code does not', t => {
  const f = fixture(t);
  for (const file of ['sdks/package.json', 'kit/auth/android/Plugin.java', '.nimi/spec/runtime/sample.authority.yaml']) {
    const targets = selectDocsReview(f.root, [file]);
    assert.deepEqual(targets, ['docs/start/web.md', 'docs/zh/start/web.md']);
    assert.equal(selectCiScope([file], { docsReviewTargets: targets }).docs_changed, true);
  }
  assert.deepEqual(selectDocsReview(f.root, ['runtime/internal/unrelated.go']), []);
});
test('locale mapping drift is visible without enforcing literal translation', t => {
  const f = fixture(t); f.write('docs/zh/start/web.md', f.page({ ...f.metadata, sources: ['sdks/package.json'] }));
  assert.match(checkDocsSources(f.root).errors.join('\n'), /Chinese counterpart/);
});
test('repository escape and malformed metadata fail closed', t => {
  const f = fixture(t); f.write('docs/start/web.md', f.page({ ...f.metadata, sources: ['../outside'] }));
  assert.throws(() => checkDocsSources(f.root), /path leaves repository/);
  f.write('docs/start/web.md', f.page({ authority: 'rule.example.active', sources: [] }));
  assert.throws(() => checkDocsSources(f.root), /string array/);
});
test('external sources are not declared broken and missing included code is detected', t => {
  const f = fixture(t);
  f.write('docs/code.md', '# Code\n\n<<< ../examples/missing.ts\n\n## Source Basis\n\n- [Realm](https://github.com/example/realm/blob/main/spec.md)\n');
  assert.deepEqual(checkDocsSources(f.root).errors, ['docs/code.md:3: missing source examples/missing.ts']);
});

test('the CI detector selects docs for a source-only commit using page bindings', t => {
  const f = fixture(t);
  const git = args => execFileSync('git', args, { cwd: f.root, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  const commit = message => {
    git(['add', '.']);
    git(['-c', 'user.name=Docs Test', '-c', 'user.email=docs@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=.git/hooks', 'commit', '-qm', message]);
    return git(['rev-parse', 'HEAD']);
  };
  const baseSha = commit('baseline');
  f.write('sdks/package.json', '{"exports":{"./remote":"./remote.js"}}');
  const headSha = commit('public entry');
  const result = detectCiScope({ repoRoot: f.root, eventName: 'push', baseSha, headSha });
  assert.equal(result.docs_changed, true);
  assert.deepEqual(result.docs_review_targets, ['docs/start/web.md', 'docs/zh/start/web.md']);
});
