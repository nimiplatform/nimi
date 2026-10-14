import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DownloadPageView, PUBLIC_PAGE_CONTENT } from '../src/pages/release-pages.js';

const REQUIRED_ATTRIBUTION = 'Free code signing provided by SignPath.io, certificate by SignPath Foundation.';

test('official routes and planned signing attribution remain clear in both locales', () => {
  for (const locale of ['en', 'zh'] as const) {
    const copy = PUBLIC_PAGE_CONTENT[locale];
    assert.equal(copy.download.meta.canonical, 'https://nimi.ai/download');
    assert.equal(copy.policy.meta.canonical, 'https://nimi.ai/code-signing');
    assert.equal(copy.download.attribution, REQUIRED_ATTRIBUTION);
    assert.equal(copy.policy.attribution, REQUIRED_ATTRIBUTION);
    assert.match(copy.download.providerLabel, /Planned|计划/u);
    assert.match(copy.policy.attributionPending, /only after|仅在/u);
    assert.match(copy.download.disclaimer, /Authenticode/);
    assert.match(copy.policy.team.items?.join('\n') ?? '', /@snowzane/);
    assert.ok(copy.policy.verificationChecks.every((check) => check.length > 0));
  }
});

test('the Beta identifies its actual platform assets and independent channel', () => {
  for (const locale of ['en', 'zh'] as const) {
    const page = PUBLIC_PAGE_CONTENT[locale].download;
    assert.match(page.statusTitle, /v0\.2\.4.*Beta/);
    for (const owner of ['nimi', 'desktop', 'runtime']) {
      assert.ok(page.versions.paragraphs.join('\n').includes(`${owner}/v<version>`));
    }
    assert.match(page.prerelease.paragraphs.join('\n'), /channel/);
    assert.match(page.release.paragraphs.join('\n'), /stable/i);
    const windows = page.platforms.find((item) => item.name === 'Windows');
    const macos = page.platforms.find((item) => item.name === 'macOS');
    const linux = page.platforms.find((item) => item.name === 'Linux');
    assert.match(windows?.detail ?? '', /Nimi-0\.2\.4-windows-amd64\.exe/);
    assert.match(windows?.detail ?? '', /10\.0\.19041/);
    assert.match(windows?.detail ?? '', /NotSigned/);
    assert.match(macos?.detail ?? '', /Nimi-0\.2\.4-macos-arm64\.pkg/);
    assert.match(macos?.detail ?? '', /13\.0/);
    assert.match(linux?.status ?? '', /No product release|无完整产品发布/u);
    assert.match(page.release.paragraphs.join('\n'), /Zhiyu/);
    assert.match(page.release.paragraphs.join('\n'), /Nimi Lab/);
  }
});

test('metadata verification does not imply Authenticode or broaden planned SignPath scope', () => {
  for (const locale of ['en', 'zh'] as const) {
    const page = PUBLIC_PAGE_CONTENT[locale].policy;
    const text = JSON.stringify(page);
    assert.match(text, /Ed25519/);
    assert.match(text, /P-SUPD-012/);
    assert.match(text, /NotSigned/);
    assert.match(page.scope.paragraphs[0] ?? '', /initial SignPath application scope remains|SignPath 初始申请范围仍是/u);
    assert.match(page.scope.paragraphs[0] ?? '', /Runtime.*nimi\.exe/);
    assert.match(page.scope.items?.join('\n') ?? '', /outside that initial SignPath request|不在该 SignPath 初始申请范围/u);
    assert.match(page.scope.items?.join('\n') ?? '', /third-party Apps|第三方 App/iu);
    assert.match(page.verificationChecks.join('\n'), /SHA-256/);
    assert.doesNotMatch(text, /SignPath (has|is) approved/i);
  }
});

test('historical cleanup is scoped to old builds and current Beta recovery uses its own guide', () => {
  for (const locale of ['en', 'zh'] as const) {
    const page = PUBLIC_PAGE_CONTENT[locale].download;
    const cleanup = page.uninstall.paragraphs.join('\n');
    assert.match(cleanup, /Historical|历史/u);
    assert.match(cleanup, /Root/);
    assert.match(cleanup, /TrustedPublisher/);
    assert.match(cleanup, /accept-runtime-fixed-service\.mjs --uninstall/);
    assert.match(page.uninstall.paragraphs[0] ?? '', /exact release|对应版本/u);
    assert.match(page.systemChanges.paragraphs.join('\n'), /_nimiruntimedev/);
    assert.match(page.systemChanges.paragraphs.join('\n'), /nimi-macos-dev-security\.lock/);
    assert.doesNotMatch(JSON.stringify(page), /v0\.2\.2-preview\.1/);
  }
});

test('App lifecycle scope preserves platform support and session admission', () => {
  for (const locale of ['en', 'zh'] as const) {
    const text = PUBLIC_PAGE_CONTENT[locale].download.release.paragraphs.join('\n');
    assert.match(text, /macOS arm64/);
    assert.match(text, /Windows x86_64/);
    assert.match(text, /updates|更新/u);
    assert.match(text, /ordinary App repair remain unavailable|普通 App 修复仍不可用/u);
    assert.match(text, /current session|当前会话/u);
  }
});

test('public routes retain crawlable metadata and sitemap entries', () => {
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

test('rendered download action follows Beta scope and unsigned-Windows disclosure', () => {
  for (const locale of ['en', 'zh'] as const) {
    const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(DownloadPageView, {
      locale, onLocaleChange: () => {},
    })));
    const action = html.indexOf('class="release-primary-action" href="https://github.com/nimiplatform/nimi/releases"');
    const scope = html.indexOf('id="preview-scope"');
    const warning = html.indexOf('id="preview-warning"');
    assert.ok(action > 0 && scope > 0 && warning > 0);
    assert.ok(scope < action && warning < action);
    assert.match(html, /aria-describedby="preview-scope preview-warning"/);
    assert.match(html.slice(scope, action), /0\.2\.4/);
    assert.match(html.slice(warning, action), /no Authenticode signature|尚无 Authenticode 签名/u);
    assert.match(html.slice(warning, action), /Do not install a development root certificate|请勿为此安装开发根证书/u);
    assert.doesNotMatch(html, /href="[^"]*releases\/download\//);
    assert.match(html, /href="#developer-details"/);
    assert.match(html, /id="developer-details"/);
    assert.match(html, /href="\/code-signing"/);
  }
});

test('both locales explain Nimi account and browser sign-in requirements', () => {
  for (const locale of ['en', 'zh'] as const) {
    const page = PUBLIC_PAGE_CONTENT[locale].download;
    assert.match(page.statusBody, /Nimi account|Nimi 账号/u);
    assert.match(page.statusBody, /browser sign-in|浏览器中登录/u);
    assert.match(page.statusBody, /Beta/);
  }
});
