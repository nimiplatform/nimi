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
    assert.match(copy.download.releaseAction, /source code|源代码/u);
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

test('download copy identifies the complete product and independently released components', () => {
  const page = PUBLIC_PAGE_CONTENT.en.download;
  assert.match(page.statusTitle, /Not yet available/);
  assert.match(page.statusBody, /no stable Nimi release or Nimi Home installer/i);
  assert.match(page.statusBody, /Desktop, Runtime, and Avatar/);
  assert.match(page.preview.title, /withdrawn/i);
  assert.match(JSON.stringify(page), /NOT PROMOTABLE/);
  assert.match(page.release.paragraphs.join('\n'), /conversations, characters, creations, stories, worlds/);
  assert.match(page.prerelease.paragraphs.join('\n'), /nimi\/vX\.Y\.Z-preview\.N/);
  assert.match(page.prerelease.paragraphs.join('\n'), /desktop\/vX\.Y\.Z-preview\.N/);
  assert.match(page.prerelease.paragraphs.join('\n'), /runtime\/vX\.Y\.Z-rc\.N/);
  assert.match(page.release.paragraphs.join('\n'), /Zhiyu and Nimi Lab are independently published Third-party Apps/);
  assert.match(page.prerelease.paragraphs.join('\n'), /never renamed, replaced, or promoted/);
  assert.match(page.sourceBuild.paragraphs.join('\n'), /never included in the GitHub unsigned-preview assets/);

  const windows = page.platforms.find((item) => item.name === 'Windows');
  assert.match(windows?.status ?? '', /No current product or preview download/);
  assert.match(windows?.detail ?? '', /replacement has not been published/);
  const macos = page.platforms.find((item) => item.name === 'macOS');
  assert.match(macos?.status ?? '', /No current product or preview download/);
  assert.match(macos?.detail ?? '', /withdrawn/);
  const linux = page.platforms.find((item) => item.name === 'Linux');
  assert.match(linux?.detail ?? '', /no official Nimi product or developer-preview download/);
  assert.match(page.preview.warning, /Do not disable Windows security controls/);
  assert.match(page.verification.paragraphs.join('\n'), /no replacement preview download/);
  assert.match(page.verification.paragraphs.join('\n'), /did not claim a release checksum set or complete SBOM/);
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
  assert.match(serialized, /replacement public unsigned Runtime bootstrap has not been published/);
  assert.match(serialized, /application has not yet been submitted/);
  assert.doesNotMatch(serialized, /application pending/i);
  assert.match(serialized, /GitHub Actions is the only production build system/);
  assert.match(serialized, /runtime\/vX\.Y\.Z-preview\.N/);
  assert.match(serialized, /never a promotion input/);
  assert.match(serialized, /expected to report NotSigned/);
  assert.match(serialized, /initial SignPath application scope is one Nimi-owned Windows x64 Runtime executable named nimi\.exe/);
  assert.match(serialized, /Authenticode on that \.node file is not a Phase 4A release gate/);
  assert.match(serialized, /never signs a third-party App or upstream binary/);
  assert.match(serialized, /next bootstrap publication must provide an independently identified Windows x64 Runtime preview/);
  assert.doesNotMatch(serialized, /Runtime executables named nimi\.exe for amd64 and arm64/);
  assert.match(serialized, /no complete product uninstall path|no admitted production uninstall flow/i);
  assert.match(serialized, /SignPath approval, production signing, post-signature verification, and repackaging are not integrated/);
  assert.match(serialized, /repair-local-agent-chat\.exe/);
  assert.match(serialized, /restricted service SID/);
  assert.doesNotMatch(serialized, /SignPath (has|is) approved/i);
});

test('withdrawn previews are not advertised as available downloads in either locale', () => {
  for (const locale of ['en', 'zh'] as const) {
    const copy = PUBLIC_PAGE_CONTENT[locale];
    const download = JSON.stringify(copy.download);
    const policy = JSON.stringify(copy.policy);
    assert.match(download, /source-local Kit/);
    assert.doesNotMatch(download, /v0\.2\.2-preview\.1/);
    assert.match(download, /withdrawn|撤回|撤下/u);
    assert.match(download, /Desktop/);
    assert.match(download, /Runtime/);
    assert.match(download, /Avatar/);
    assert.match(download, /Zhiyu/);
    assert.match(download, /Nimi Lab/);
    assert.match(download, /version --json/);
    assert.match(download, /delete the extracted directory|删除解压目录/u);
    assert.match(download, /Do not disable Windows security controls|不要为了运行未签名文件而关闭 Windows 安全能力/u);
    assert.match(policy, /Windows x64 Runtime/);
    assert.match(policy, /Phase 4A/);
    assert.match(policy, /third-party App|第三方 App/u);
    assert.match(policy, /SubjectPublicKeyInfo/);
    assert.match(policy, /SPKI/);
    assert.match(policy, /application has not yet been submitted|申请尚未提交/u);
    assert.match(policy, /does not enable protected-local production|不会使 protected-local production 可用/u);
    assert.doesNotMatch(policy, /current admitted Windows release scope|当前准入的 Windows release 签名范围/u);
  }
  assert.doesNotMatch(
    RELEASE_PAGES_SOURCE,
    /releases\/(?:tag|download)\/v\d/,
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


test('download renders the withdrawal before its source action and retains cleanup guidance', () => {
  for (const locale of ['en', 'zh'] as const) {
    const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(DownloadPageView, {
      locale,
      onLocaleChange: () => {},
    })));
    const action = html.indexOf('class="release-primary-action" href="https://github.com/nimiplatform/nimi"');
    const scope = html.indexOf('id="preview-scope"');
    const warning = html.indexOf('id="preview-warning"');
    assert.ok(action > 0 && scope > 0 && warning > 0);
    assert.ok(scope < action && warning < action);
    assert.match(html, /aria-describedby="preview-scope preview-warning"/);
    assert.match(html.slice(scope, action), /withdrawn|撤回/);
    assert.match(html.slice(warning, action), /Do not disable Windows security controls|不要为了运行未签名文件而关闭 Windows 安全能力/);
    assert.doesNotMatch(html, /href="[^"]*releases\/download\//);
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
