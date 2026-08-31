import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PUBLIC_PAGE_CONTENT } from '../src/pages/release-pages.js';

const REQUIRED_ATTRIBUTION = 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.';
const REQUIRED_DISCLAIMER = 'No current Nimi artifact should be treated as SignPath-signed unless its Authenticode signature verifies successfully.';

test('public release pages keep English and Chinese structures complete', () => {
  for (const locale of ['en', 'zh'] as const) {
    const copy = PUBLIC_PAGE_CONTENT[locale];
    assert.equal(copy.download.meta.canonical, 'https://nimi.ai/download');
    assert.match(copy.download.releaseAction, /GitHub|GitHub Releases/u);
    assert.equal(copy.policy.meta.canonical, 'https://nimi.ai/code-signing');
    assert.equal(copy.download.platforms.length, 4);
    assert.ok(copy.download.platforms.every((platform) => platform.status.length > 0));
    assert.equal(copy.download.attribution, REQUIRED_ATTRIBUTION);
    assert.equal(copy.download.disclaimer, REQUIRED_DISCLAIMER);
    assert.equal(copy.policy.attribution, REQUIRED_ATTRIBUTION);
    assert.ok(copy.policy.status.paragraphs.length >= 3);
    assert.ok(copy.policy.scope.items && copy.policy.scope.items.length === 3);
    assert.ok(copy.policy.verificationChecks.length >= 5);
    assert.match(copy.policy.metadataBlocker, /PE Product Name/);
    assert.match(copy.policy.team.items?.join('\n') ?? '', /@snowzane/);
  }
});

test('download copy separates stable, unsigned preview, and signed RC paths', () => {
  const page = PUBLIC_PAGE_CONTENT.en.download;
  assert.match(page.statusTitle, /Not yet available/);
  assert.match(page.statusBody, /No stable Nimi GitHub Release has been published/);
  assert.match(page.statusBody, /vX\.Y\.Z-preview\.N/);
  assert.match(page.release.paragraphs.join('\n'), /conversations, characters, creations, stories, worlds/);
  assert.match(page.prerelease.paragraphs.join('\n'), /vX\.Y\.Z-preview\.N/);
  assert.match(page.prerelease.paragraphs.join('\n'), /vX\.Y\.Z-rc\.N/);
  assert.match(page.prerelease.paragraphs.join('\n'), /never renamed, replaced, or promoted/);
  assert.match(page.sourceBuild.paragraphs.join('\n'), /never included in the GitHub unsigned-preview assets/);

  const windows = page.platforms.find((item) => item.name === 'Windows');
  assert.match(windows?.detail ?? '', /does not contain a Nimi app, Runtime archive, installer, or Windows service/);
  const macos = page.platforms.find((item) => item.name === 'macOS');
  assert.match(macos?.detail ?? '', /ad-hoc candidate/);
  assert.match(macos?.detail ?? '', /exact source checkout/);
  const linux = page.platforms.find((item) => item.name === 'Linux');
  assert.match(linux?.detail ?? '', /no Linux Runtime archive/);
  assert.match(page.verification.paragraphs.join('\n'), /no Runtime archive/);
  assert.match(page.verification.paragraphs.join('\n'), /does not claim a checksum or SBOM/);
  assert.match(page.verification.paragraphs.join('\n'), /complete MIT and Apache-2\.0 texts/);
  assert.match(page.systemChanges.paragraphs.join('\n'), /_nimiruntimedev/);
  assert.match(page.systemChanges.paragraphs.join('\n'), /nimi-macos-dev-security\.lock/);
  assert.match(page.uninstall.paragraphs.join('\n'), /accept-runtime-fixed-service\.mjs --uninstall/);
});

test('code signing copy names current blockers without claiming SignPath approval', () => {
  const page = PUBLIC_PAGE_CONTENT.en.policy;
  const serialized = JSON.stringify(page);
  assert.match(serialized, /Pending SignPath Foundation approval/);
  assert.match(serialized, /There is no production-signed Windows release/);
  assert.match(serialized, /application is pending/);
  assert.match(serialized, /GitHub Actions is the only production build system/);
  assert.match(serialized, /vX\.Y\.Z-preview\.N/);
  assert.match(serialized, /never a promotion input/);
  assert.match(serialized, /expected to report NotSigned/);
  assert.match(serialized, /nimi\.exe for Windows amd64 and arm64/);
  assert.match(serialized, /win32-x64 Node \.node binary/);
  assert.match(serialized, /no complete product uninstall path|no admitted production uninstall flow/i);
  assert.match(serialized, /production SignPath signing, post-signature verification and repackaging gates are not integrated/);
  assert.match(serialized, /repair-local-agent-chat\.exe/);
  assert.match(serialized, /restricted service SID/);
  assert.doesNotMatch(serialized, /SignPath (has|is) approved/i);
});

test('clean public routes have route declarations, crawlable metadata, and sitemap entries', () => {
  const router = readFileSync(new URL('../src/site-router.tsx', import.meta.url), 'utf8');
  const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  const downloadHtml = readFileSync(new URL('../download.html', import.meta.url), 'utf8');
  const policyHtml = readFileSync(new URL('../code-signing.html', import.meta.url), 'utf8');

  assert.match(router, /path="\/download"/);
  assert.match(router, /path="\/code-signing"/);
  assert.match(sitemap, /https:\/\/nimi\.ai\/download/);
  assert.match(sitemap, /https:\/\/nimi\.ai\/code-signing/);
  assert.match(downloadHtml, /rel="canonical" href="https:\/\/nimi\.ai\/download"/);
  assert.match(policyHtml, /rel="canonical" href="https:\/\/nimi\.ai\/code-signing"/);
  assert.match(downloadHtml, /property="og:title" content="Download Nimi/);
  assert.match(policyHtml, /property="og:title" content="Code signing policy/);
});
