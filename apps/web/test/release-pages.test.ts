import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DownloadPageView, PUBLIC_PAGE_CONTENT } from '../src/pages/release-pages.js';

const REQUIRED_ATTRIBUTION = 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.';
const REQUIRED_DISCLAIMER = 'No current Nimi artifact should be treated as SignPath-signed unless its Authenticode signature verifies successfully.';
const RELEASE_PAGES_SOURCE = readFileSync(new URL('../src/pages/release-pages.tsx', import.meta.url), 'utf8');

test('public release pages retain platform status and required signing disclosures in both locales', () => {
  for (const locale of ['en', 'zh'] as const) {
    const copy = PUBLIC_PAGE_CONTENT[locale];
    assert.equal(copy.download.meta.canonical, 'https://nimi.ai/download');
    assert.match(copy.download.releaseAction, /v0\.2\.2-preview\.1/u);
    assert.equal(copy.policy.meta.canonical, 'https://nimi.ai/code-signing');
    assert.ok(['Windows', 'macOS', 'Linux'].every((name) => copy.download.platforms.some((platform) => platform.name === name)));
    assert.ok(copy.download.platforms.every((platform) => platform.status.length > 0));
    assert.equal(copy.download.attribution, REQUIRED_ATTRIBUTION);
    assert.equal(copy.download.disclaimer, REQUIRED_DISCLAIMER);
    assert.equal(copy.policy.attribution, REQUIRED_ATTRIBUTION);
    assert.ok(copy.policy.verificationChecks.every((check) => check.length > 0));
    assert.match(copy.policy.metadataBlocker, /PE Product Name/);
    assert.match(copy.policy.team.items?.join('\n') ?? '', /@snowzane/);
  }
});

test('download copy separates stable, unsigned preview, and signed RC paths', () => {
  const page = PUBLIC_PAGE_CONTENT.en.download;
  assert.match(page.statusTitle, /Not yet available/);
  assert.match(page.statusBody, /no stable Nimi release or Nimi Home installer/i);
  assert.match(JSON.stringify(page), /v0\.2\.2-preview\.1/);
  assert.match(JSON.stringify(page), /NOT PROMOTABLE/);
  assert.match(page.release.paragraphs.join('\n'), /conversations, characters, creations, stories, worlds/);
  assert.match(page.prerelease.paragraphs.join('\n'), /vX\.Y\.Z-preview\.N/);
  assert.match(page.prerelease.paragraphs.join('\n'), /vX\.Y\.Z-rc\.N/);
  assert.match(page.prerelease.paragraphs.join('\n'), /never renamed, replaced, or promoted/);
  assert.match(page.sourceBuild.paragraphs.join('\n'), /never included in the GitHub unsigned-preview assets/);

  const windows = page.platforms.find((item) => item.name === 'Windows');
  assert.match(windows?.detail ?? '', /portable unsigned Windows x64 Runtime bootstrap/);
  assert.match(windows?.detail ?? '', /no Nimi Home app, installer, Windows service package, or protected-local production release/);
  const macos = page.platforms.find((item) => item.name === 'macOS');
  assert.match(macos?.detail ?? '', /ad-hoc candidate/);
  assert.match(macos?.detail ?? '', /exact source checkout/);
  const linux = page.platforms.find((item) => item.name === 'Linux');
  assert.match(linux?.detail ?? '', /no Linux Runtime archive/);
  assert.match(page.verification.paragraphs.join('\n'), /Nimi-Runtime-v0\.2\.2-preview\.1-windows-x64-unsigned-bootstrap\.zip/);
  assert.match(page.preview.warning, /SmartScreen, Smart App Control, or an organization policy may warn or block it/);
  assert.match(page.preview.warning, /Do not disable Windows security controls/);
  assert.match(page.verification.paragraphs.join('\n'), /no release-owned checksums file/);
  assert.match(page.verification.paragraphs.join('\n'), /does not claim a release checksum set or complete SBOM/);
  assert.match(page.verification.paragraphs.join('\n'), /complete MIT and Apache-2\.0 texts/);
  assert.match(page.systemChanges.paragraphs.join('\n'), /_nimiruntimedev/);
  assert.match(page.systemChanges.paragraphs.join('\n'), /nimi-macos-dev-security\.lock/);
  assert.match(page.uninstall.paragraphs.join('\n'), /accept-runtime-fixed-service\.mjs --uninstall/);
  assert.match(page.uninstall.paragraphs.join('\n'), /delete the extracted directory/);
});

test('code signing copy names current blockers without claiming SignPath approval', () => {
  const page = PUBLIC_PAGE_CONTENT.en.policy;
  const serialized = JSON.stringify(page);
  assert.match(serialized, /SignPath Foundation application not submitted/);
  assert.match(serialized, /There is no production-signed Windows release/);
  assert.match(serialized, /required public unsigned Runtime bootstrap was published/);
  assert.match(serialized, /application has not yet been submitted/);
  assert.doesNotMatch(serialized, /application pending/i);
  assert.match(serialized, /GitHub Actions is the only production build system/);
  assert.match(serialized, /vX\.Y\.Z-preview\.N/);
  assert.match(serialized, /never a promotion input/);
  assert.match(serialized, /expected to report NotSigned/);
  assert.match(serialized, /initial SignPath application scope is one Nimi-owned Windows x64 Runtime executable named nimi\.exe/);
  assert.match(serialized, /Authenticode on that \.node file is not a Phase 4A release gate/);
  assert.match(serialized, /never signs a third-party App or upstream binary/);
  assert.match(serialized, /first bootstrap step is complete/);
  assert.match(serialized, /Next, apply to SignPath Foundation/);
  assert.doesNotMatch(serialized, /Runtime executables named nimi\.exe for amd64 and arm64/);
  assert.match(serialized, /no complete product uninstall path|no admitted production uninstall flow/i);
  assert.match(serialized, /SignPath approval, production signing, post-signature verification, and repackaging are not integrated/);
  assert.match(serialized, /repair-local-agent-chat\.exe/);
  assert.match(serialized, /restricted service SID/);
  assert.doesNotMatch(serialized, /SignPath (has|is) approved/i);
});

test('published unsigned bootstrap remains distinct from signed and protected-local production', () => {
  for (const locale of ['en', 'zh'] as const) {
    const copy = PUBLIC_PAGE_CONTENT[locale];
    const download = JSON.stringify(copy.download);
    const policy = JSON.stringify(copy.policy);
    assert.match(download, /source-local Kit/);
    assert.match(download, /v0\.2\.2-preview\.1/);
    assert.match(download, /portable Runtime ZIP|portable Windows x64 Runtime bootstrap/u);
    assert.match(download, /version --json/);
    assert.match(download, /delete the extracted directory|删除解压目录/u);
    assert.match(download, /Do not disable Windows security controls|不要为了运行此 preview 而关闭 Windows 安全能力/u);
    assert.match(policy, /Windows x64 Runtime/);
    assert.match(policy, /Phase 4A/);
    assert.match(policy, /third-party App|第三方 App/u);
    assert.match(policy, /SubjectPublicKeyInfo/);
    assert.match(policy, /SPKI/);
    assert.match(policy, /application has not yet been submitted|申请尚未提交/u);
    assert.match(policy, /does not enable protected-local production|不会使 protected-local production 可用/u);
    assert.doesNotMatch(policy, /current admitted Windows release scope|当前准入的 Windows release 签名范围/u);
  }
  assert.match(RELEASE_PAGES_SOURCE, /releases\/tag\/v0\.2\.2-preview\.1/);
  assert.match(
    RELEASE_PAGES_SOURCE,
    /releases\/download\/v0\.2\.2-preview\.1\/Nimi-Runtime-v0\.2\.2-preview\.1-windows-x64-unsigned-bootstrap\.zip/,
  );
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


test('download renders scope and security warning before the exact asset action, with public details reachable', () => {
  for (const locale of ['en', 'zh'] as const) {
    const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(DownloadPageView, {
      locale,
      onLocaleChange: () => {},
    })));
    const assetUrl = 'https://github.com/nimiplatform/nimi/releases/download/v0.2.2-preview.1/Nimi-Runtime-v0.2.2-preview.1-windows-x64-unsigned-bootstrap.zip';
    const action = html.indexOf(`href="${assetUrl}"`);
    const scope = html.indexOf('id="preview-scope"');
    const warning = html.indexOf('id="preview-warning"');
    assert.ok(action > 0 && scope > 0 && warning > 0);
    assert.ok(scope < action && warning < action);
    assert.match(html, /aria-describedby="preview-scope preview-warning"/);
    assert.match(html.slice(scope, action), /no Nimi Home app|不包含 Nimi Home/);
    assert.match(html.slice(warning, action), /Do not disable Windows security controls|不要为了运行此 preview 而关闭 Windows 安全能力/);
    assert.match(html, /href="#developer-details"/);
    assert.match(html, /id="developer-details"/);
    assert.match(html, /href="\/code-signing"/);
    assert.match(html, /_nimiruntimedev/);
    assert.match(html, /accept-runtime-fixed-service\.mjs --uninstall/);
    assert.match(html, /NOT PROMOTABLE/);
    assert.match(html, /Realm/);
    assert.match(html, /Developer Mode/);
    assert.match(html, /Registry/);
  }
});
