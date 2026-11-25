import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  accountHandle,
  accountLoginUrl,
  accountReturnTo,
  evaluateHandleDraft,
  normalizeHandleInput,
  profilePatch,
  resolveWebAuthHeadingKey,
} from '../src/auth/account-center-model.js';
import { friendRequestFailure, loadAccountPeople } from '../src/auth/account-friends.js';
import { createNimiError } from '@nimiplatform/sdk/types';
import { accountReadProblem } from '../src/auth/account-center-copy.js';
import {
  AccountOverviewView,
  hostedWebAppsFromProducts,
  loadHostedWebApps,
} from '../src/auth/account-overview.js';
import { AccountAvatar, AccountFrame } from '../src/auth/account-center-layout.js';
import { AccountDownloadView } from '../src/auth/account-download.js';
import { AccountRuntimeView } from '../src/auth/account-runtime.js';
import { AccountRuntimeManagerView, deriveLivePhase } from '../src/auth/account-runtime-manager.js';
import { RemoteSourceAccessState } from '@nimiplatform/sdk/runtime/wire-types';
import { initializeWebAccountI18n } from '../src/auth/i18n.js';
import {
  detectVisitorPlatform,
  NIMI_MACOS_DOWNLOAD_URL,
  NIMI_WINDOWS_DOWNLOAD_URL,
} from '../src/pages/download-assets.js';

test('sign-in returns to an admitted account page and preserves the selected request list', () => {
  const link = accountLoginUrl('/account/friends', '?view=received');
  assert.equal(
    accountReturnTo(new URL(link, 'https://nimi.test').search),
    '/account/friends?view=received',
  );
  assert.equal(accountReturnTo('?returnTo=%2Faccount%2Fprivacy'), '/account/privacy');
  for (const target of [
    'https://evil.test/account',
    '//evil.test/account',
    '/account/../login',
    '/account/not-real',
    'javascript:alert(1)',
  ]) {
    assert.equal(accountReturnTo(`?returnTo=${encodeURIComponent(target)}`), '/account');
  }
  assert.equal(
    accountReturnTo(
      `?returnTo=${encodeURIComponent('/account/friends?view=sent&token=do-not-propagate')}`,
    ),
    '/account/friends?view=sent',
  );
  assert.equal(accountReturnTo('?next=https%3A%2F%2Frealm.test%2Fauthorize'), '/account');
  assert.equal(accountLoginUrl('/account', '?lang=zh'), '/login?returnTo=%2Faccount&lang=zh');
  assert.equal(
    accountReturnTo(new URL(accountLoginUrl('/account', '?lang=zh'), 'https://nimi.test').search),
    '/account',
  );
  assert.equal(resolveWebAuthHeadingKey('/login', ''), 'Auth.signInTitle');
  assert.equal(resolveWebAuthHeadingKey('/register', ''), 'Auth.signUpTitle');
  assert.equal(
    resolveWebAuthHeadingKey('/login', `?returnTo=${encodeURIComponent('/account/runtime?intent=6b05fd00-4c98-40dd-9c0c-2ca0d9d60ab7')}`),
    'Auth.runtimeSignInTitle',
  );
  assert.equal(
    resolveWebAuthHeadingKey('/login', '?oauth_next=https%3A%2F%2Frealm.nimi.ai%2Fapi%2Fauth%2Foauth%2Fauthorize%3Fstate%3Dabc'),
    'Auth.oauthSignInTitle',
  );
});

test('manager callback survives ordinary login only with the exact bounded code and state', () => {
  const callback = `?code=${'c'.repeat(43)}&state=${'s'.repeat(43)}`;
  const login = accountLoginUrl('/account/runtime', callback);
  assert.equal(accountReturnTo(new URL(login, 'https://nimi.test').search), '/account/runtime' + callback);
  assert.equal(accountReturnTo(`?returnTo=${encodeURIComponent('/account/runtime' + callback + '&token=unsafe')}`), '/account/runtime');
  assert.equal(accountReturnTo(`?returnTo=${encodeURIComponent('/account/runtime?code=invalid&state=invalid')}`), '/account/runtime');
});

test('profile editing sends only changed fields and explicitly clears optional information', () => {
  const original = {
    displayName: 'Alice',
    bio: '  Authored spacing  ',
    city: 'Shanghai',
    countryCode: 'CN',
    gender: 'FEMALE',
  };
  assert.deepEqual(
    profilePatch(original, {
      displayName: 'Alice',
      bio: original.bio,
      city: 'Shanghai',
      countryCode: 'CN',
    }),
    {},
  );
  assert.deepEqual(
    profilePatch(original, {
      displayName: ' Alice New ',
      bio: '',
      city: 'Shanghai',
      countryCode: 'CN',
    }),
    { displayName: 'Alice New', bio: null },
  );
  assert.equal(accountHandle('@alice'), 'alice');
  assert.equal(accountHandle('alice'), 'alice');
});

test('username draft normalization strips leading @, lowercases when required, and evaluates rules', () => {
  assert.deepEqual(normalizeHandleInput('@Halliday_01'), {
    value: 'halliday_01',
    strippedAt: true,
    lowercased: true,
  });
  assert.deepEqual(normalizeHandleInput('@@alice'), {
    value: 'alice',
    strippedAt: true,
    lowercased: false,
  });
  assert.deepEqual(normalizeHandleInput('Halliday', true), {
    value: 'Halliday',
    strippedAt: false,
    lowercased: false,
  });

  const rule = { handle: '@halliday', minLength: 4, maxLength: 16, pattern: '^[a-z0-9_]+$' };
  assert.deepEqual(evaluateHandleDraft('', rule), {
    touched: false,
    lengthOk: false,
    patternOk: false,
    differentOk: false,
    formatValid: false,
  });
  assert.deepEqual(evaluateHandleDraft('halliday', rule), {
    touched: true,
    lengthOk: true,
    patternOk: true,
    differentOk: false,
    formatValid: false,
  });
  assert.deepEqual(evaluateHandleDraft('hi!', rule), {
    touched: true,
    lengthOk: false,
    patternOk: false,
    differentOk: true,
    formatValid: false,
  });
  assert.deepEqual(evaluateHandleDraft('new_halliday', rule), {
    touched: true,
    lengthOk: true,
    patternOk: true,
    differentOk: true,
    formatValid: true,
  });
});

test('primary Runtime sign-in keeps only a well-formed intent in the account destination', () => {
  const id = '6b05fd00-4c98-40dd-9c0c-2ca0d9d60ab7';
  const link = accountLoginUrl('/account/runtime', `?intent=${id}&token=never-forward`);
  assert.equal(accountReturnTo(new URL(link, 'https://nimi.test').search), `/account/runtime?intent=${id}`);
  assert.equal(accountReturnTo(`?returnTo=${encodeURIComponent('/account/runtime?intent=invalid')}`), '/account/runtime');
});

test('request pages retain exact relationship identities and read only the requested direction', async () => {
  const calls: unknown[] = [];
  const realm = {
    generated: {
      getMyPendingFriendRequests: async (request: unknown) => {
        calls.push(request);
        return {
          items: [
            {
              userId: 'peer',
              displayName: 'Peer',
              handle: '@peer',
              avatarUrl: null,
              isDeleted: false,
              relationshipId: 'request-specific-id',
              requestMessage: 'Hello',
              requestedAt: '2026-10-31T00:00:00Z',
            },
          ],
          nextCursor: 'next-boundary',
          total: 29,
        };
      },
      getUser: () => assert.fail('A request list must not require a full profile read'),
    },
  };
  for (const direction of ['received', 'sent'] as const) {
    const page = await loadAccountPeople(realm as never, direction, 'start-boundary');
    assert.equal(page.items[0]?.id, 'peer');
    assert.equal(page.items[0]?.relationshipId, 'request-specific-id');
    assert.equal(page.total, 29);
    assert.equal(page.nextCursor, 'next-boundary');
  }
  assert.deepEqual(
    calls,
    ['received', 'sent'].map((direction) => ({
      path: {},
      query: { cursor: 'start-boundary', direction, limit: 20 },
    })),
  );
});

test('a failed people list remains a read error instead of a false empty list', async () => {
  const error = new Error('Realm unavailable');
  const realm = {
    generated: {
      getMyPendingFriendRequests: async () => {
        throw error;
      },
    },
  };
  await assert.rejects(loadAccountPeople(realm as never, 'received'), (value) => value === error);
});

test('account reads explain a rate limit without exposing server exception text or asking for login', () => {
  const failure = createNimiError({
    source: 'realm',
    reasonCode: 'REALM_REQUEST_FAILED',
    message: 'ThrottlerException: Too Many Requests',
    details: { status: 429 },
  });
  assert.equal(
    accountReadProblem(failure, (key) => key),
    'tooManyRequests',
  );
});

test('a rejected request can be corrected while an uncertain submission requires checking its result', () => {
  const failure = (status: number) =>
    createNimiError({
      source: 'realm',
      reasonCode: 'REALM_REQUEST_FAILED',
      message: 'Request failed',
      details: { status },
    });
  assert.deepEqual(friendRequestFailure(failure(404)), { uncertain: false, copy: 'userNotFound' });
  assert.deepEqual(friendRequestFailure(failure(403)), { uncertain: false, copy: 'requestDenied' });
  assert.equal(friendRequestFailure(failure(500)).uncertain, true);
  assert.equal(friendRequestFailure(failure(200)).uncertain, true);
  assert.equal(friendRequestFailure(failure(408)).uncertain, true);
  assert.equal(friendRequestFailure(new Error('connection lost')).uncertain, true);
});

test('visitor platform detection classifies desktop, mobile, and linux user agents', () => {
  assert.equal(detectVisitorPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'macos');
  assert.equal(detectVisitorPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(detectVisitorPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'mobile');
  assert.equal(detectVisitorPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9)'), 'mobile');
  assert.equal(detectVisitorPlatform('Mozilla/5.0 (X11; Linux x86_64)'), 'linux');
  assert.equal(detectVisitorPlatform(''), null);
});

test('hosted web app parser keeps only unblocked products with verified slug-matched Web URLs', () => {
  const parsed = hostedWebAppsFromProducts([
    {
      slug: 'zhiyu',
      display_name: '织羽',
      summary: { zh: '日常陪伴应用', en: 'Companion chat app' },
      blocked: false,
      icon_url: '/.well-known/nimi-apps/media/abc',
      web: { url: 'https://zhiyu.nimi.xyz/', version: '0.4.0' },
    },
    {
      slug: 'blocked-app',
      display_name: 'Suspended',
      summary: { zh: '已停用', en: 'Suspended' },
      blocked: true,
      web: { url: 'https://blocked-app.nimi.xyz/', version: '1.0.0' },
    },
    {
      slug: 'desktop-only',
      display_name: 'Desktop Only',
      summary: { zh: '仅桌面', en: 'Desktop only' },
      blocked: false,
      web: null,
    },
    {
      slug: 'spoofed',
      display_name: 'Spoofed',
      summary: { zh: '异常', en: 'Bad' },
      blocked: false,
      web: { url: 'https://evil.example/', version: '1.0.0' },
    },
  ]);
  assert.deepEqual(parsed, [
    {
      slug: 'zhiyu',
      displayName: '织羽',
      summary: { zh: '日常陪伴应用', en: 'Companion chat app' },
      iconUrl: '/.well-known/nimi-apps/media/abc',
      web: { url: 'https://zhiyu.nimi.xyz/', version: '0.4.0' },
    },
  ]);
});

test('launchpad follows directory cursors and requires an explicit unblocked release on every page', async (t) => {
  const product = (slug: string) => ({
    slug, display_name: slug, summary: { zh: slug, en: slug },
    web: { url: `https://${slug}.nimi.xyz/`, version: '1.0' },
  });
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    if (url === '/.well-known/nimi-apps') {
      return Response.json({ products: [
        product('missing-flag'), { ...product('wrong-flag'), blocked: 'false' },
        { ...product('first'), blocked: false },
      ], next: 'first' });
    }
    assert.equal(url, '/.well-known/nimi-apps?after=first');
    return Response.json({ products: [
      { ...product('second'), blocked: false }, { ...product('blocked'), blocked: true },
    ], next: null });
  });
  const apps = await loadHostedWebApps(new AbortController().signal);
  assert.deepEqual(apps.map(app => app.slug), ['first', 'second']);
  assert.equal(urls.length, 2);
});

test('unbound account overview guides new desktop users with honest Beta disclosures and next steps', () => {
  const user = {
    id: 'u-1',
    displayName: 'Halliday',
    handle: '@halliday',
    isTwoFactorEnabled: false,
  };

  for (const locale of ['zh', 'en'] as const) {
    const macHtml = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {},
        createElement(AccountOverviewView, {
          user,
          runtimeStatus: { kind: 'unbound' },
          platform: 'macos',
          locale,
        }),
      ),
    );
    assert.match(macHtml, /data-overview-mode="onboarding"/);
    assert.ok(macHtml.includes(`href="${NIMI_MACOS_DOWNLOAD_URL}"`));
    assert.ok(macHtml.includes('href="/account/runtime"'));
    assert.ok(macHtml.includes('href="/account/profile"'));
    assert.ok(macHtml.includes(`href="/apps?lang=${locale}"`));
    assert.ok(macHtml.includes(`href="/home?lang=${locale}"`));

    const winHtml = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {},
        createElement(AccountOverviewView, {
          user,
          runtimeStatus: { kind: 'unbound' },
          platform: 'windows',
          locale,
        }),
      ),
    );
    const warningIdx = winHtml.indexOf('SmartScreen');
    const exeIdx = winHtml.indexOf(`href="${NIMI_WINDOWS_DOWNLOAD_URL}"`);
    assert.ok(warningIdx > 0 && exeIdx > warningIdx, 'Windows Authenticode/SmartScreen notice must precede direct .exe CTA');

    const mobileHtml = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {},
        createElement(AccountOverviewView, {
          user,
          runtimeStatus: { kind: 'unbound' },
          platform: 'mobile',
          locale,
        }),
      ),
    );
    assert.ok(!mobileHtml.includes(NIMI_MACOS_DOWNLOAD_URL));
    assert.ok(!mobileHtml.includes(NIMI_WINDOWS_DOWNLOAD_URL));
    assert.match(mobileHtml, /复制电脑端下载链接|Copy desktop download link/u);
  }
});

test('bound account overview surfaces primary host management, verified Web apps, and pending requests', () => {
  const user = {
    id: 'u-1',
    displayName: 'Halliday',
    handle: '@halliday',
    isTwoFactorEnabled: true,
  };
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      {},
      createElement(AccountOverviewView, {
        user,
        runtimeStatus: {
          kind: 'bound',
          binding: {
            bindingId: 'b-1',
            displayName: 'Halliday MacBook Pro',
            validAfter: '2026-11-24T04:00:00.000Z',
          },
        },
        hostedWebApps: [
          {
            slug: 'zhiyu',
            displayName: '织羽',
            summary: { zh: '跨软件接续的伙伴应用', en: 'Companion app across screens' },
            iconUrl: null,
            web: { url: 'https://zhiyu.nimi.xyz/', version: '0.4.0' },
          },
        ],
        pendingReceivedCount: 2,
        platform: 'macos',
        locale: 'zh',
      }),
    ),
  );
  assert.match(html, /data-overview-mode="bound"/);
  assert.ok(html.includes('Halliday MacBook Pro'));
  assert.ok(html.includes('href="/account/runtime"'));
  assert.ok(html.includes('href="https://zhiyu.nimi.xyz/"'));
  assert.ok(html.includes('href="/account/friends?view=received"'));
  assert.ok(html.includes('2 条好友申请待处理'));
  assert.ok(!html.includes('v0.4.0'), 'Launchpad app tiles omit semver clutter on the main face');
});

test('hosted web app parser extracts canonical categories and tags while ignoring unknown categories', () => {
  const parsed = hostedWebAppsFromProducts([
    {
      slug: 'open-notebook',
      display_name: 'Open Notebook',
      summary: { zh: '个人研究工作区', en: 'Private research workspace' },
      blocked: false,
      category: 'research-learning',
      tags: { zh: ['隐私研究', ''], en: ['Research'] },
      web: { url: 'https://open-notebook.nimi.xyz/', version: '1.15.1' },
    },
    {
      slug: 'mystery',
      display_name: 'Mystery',
      summary: { zh: '测试', en: 'Test' },
      blocked: false,
      category: 'not-a-real-category',
      web: { url: 'https://mystery.nimi.xyz/', version: '0.1.0' },
    },
  ]);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.category, 'research-learning');
  assert.deepEqual(parsed[0]?.tags, { zh: ['隐私研究'], en: ['Research'] });
  assert.equal(parsed[1]?.category, undefined);
});

test('bound overview hides past activation timestamps, surfaces future activation windows, and shows category filters when multiple categories exist', () => {
  const user = {
    id: 'u-1',
    displayName: 'Halliday',
    handle: '@halliday',
    isTwoFactorEnabled: false,
  };
  const apps = [
    {
      slug: 'open-notebook',
      displayName: 'Open Notebook',
      summary: { zh: '个人研究工作区', en: 'Private research workspace' },
      iconUrl: null,
      category: 'research-learning' as const,
      tags: { zh: ['隐私研究'] },
      web: { url: 'https://open-notebook.nimi.xyz/', version: '1.15.1' },
    },
    {
      slug: 'openmontage',
      displayName: 'OpenMontage',
      summary: { zh: '视频编排工坊', en: 'Video composition studio' },
      iconUrl: null,
      category: 'video-media' as const,
      web: { url: 'https://openmontage.nimi.xyz/', version: '0.1.3' },
    },
  ];

  const pastHtml = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      {},
      createElement(AccountOverviewView, {
        user,
        runtimeStatus: {
          kind: 'bound',
          binding: {
            bindingId: 'b-1',
            displayName: 'Harness Source Dev',
            validAfter: '2026-11-19T05:09:18.000Z',
          },
        },
        hostedWebApps: apps,
        pendingReceivedCount: 0,
        platform: 'macos',
        locale: 'zh',
        nowMs: Date.parse('2026-11-24T04:00:00.000Z'),
      }),
    ),
  );
  assert.ok(!pastHtml.includes('远程接入最早生效时间'), 'Past activation timestamps belong in /account/runtime');
  assert.ok(!pastHtml.includes('ac-space-pending-link'), 'Pending requests pill stays hidden when count is 0');
  assert.ok(!pastHtml.includes('ac-utility-strip'), 'Redundant bottom utility cards stay removed');
  assert.ok(pastHtml.includes('研究与学习'));
  assert.ok(pastHtml.includes('视频与媒体'));
  assert.ok(pastHtml.includes('隐私研究'));

  const futureHtml = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      {},
      createElement(AccountOverviewView, {
        user,
        runtimeStatus: {
          kind: 'bound',
          binding: {
            bindingId: 'b-1',
            displayName: 'Harness Source Dev',
            validAfter: '2026-11-24T04:01:00.000Z',
          },
        },
        hostedWebApps: apps,
        pendingReceivedCount: 0,
        platform: 'macos',
        locale: 'zh',
        nowMs: Date.parse('2026-11-24T04:00:00.000Z'),
      }),
    ),
  );
  assert.ok(futureHtml.includes('远程接入最早生效时间'), 'Future activation window stays visible during the initial minute');
});

test('account frame keeps only in-portal tabs in topbar and renders a left sidebar only on settings routes', async () => {
  await initializeWebAccountI18n();
  const user = { id: 'u-1', displayName: 'Halliday', handle: '@halliday', isTwoFactorEnabled: false };

  const portalHtml = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ['/account'] },
      createElement(AccountFrame, {
        user,
        working: false,
        pendingReceivedCount: 2,
        onSignOut: () => {},
        children: createElement('div', {}, 'portal-body'),
      }),
    ),
  );
  assert.match(portalHtml, /data-account-layout="portal"/);
  assert.ok(!portalHtml.includes('ac-settings-sidebar'), 'My Space stays sidebar-free');
  assert.ok(portalHtml.includes('href="/account/download"'), 'Download tab stays inside the account shell');
  const portalNavMatch = portalHtml.match(/<nav class="ac-portal-nav"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(portalNavMatch && !portalNavMatch[1]!.includes('href="/apps'), 'Public marketing /apps is not mixed into the in-portal top tab bar');
  assert.ok(portalHtml.includes('ac-friend-alert-pill'));
  assert.ok(portalHtml.includes('ac-topbar-lang'), 'Account topbar uses the shared landing LanguageToggle');
  assert.match(portalHtml, /aria-haspopup="menu"[^>]*aria-label="(?:语言|Language)"/);

  const settingsHtml = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ['/account/profile'] },
      createElement(AccountFrame, {
        user,
        working: false,
        pendingReceivedCount: 0,
        onSignOut: () => {},
        children: createElement('div', {}, 'profile-body'),
      }),
    ),
  );
  assert.match(settingsHtml, /data-account-layout="settings"/);
  assert.ok(settingsHtml.includes('ac-settings-sidebar'), 'Settings subpages render the vertical left sidebar');
  assert.ok(settingsHtml.includes('ac-back-portal'));
  assert.ok(!settingsHtml.includes('ac-friend-alert-pill'));

  const hostHtml = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ['/account/runtime'] },
      createElement(AccountFrame, {
        user,
        working: false,
        pendingReceivedCount: 0,
        onSignOut: () => {},
        children: createElement('div', {}, 'host-body'),
      }),
    ),
  );
  assert.match(hostHtml, /data-account-layout="host"/);
  assert.ok(!hostHtml.includes('ac-settings-sidebar'));

  const downloadHtml = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ['/account/download'] },
      createElement(AccountFrame, {
        user,
        working: false,
        pendingReceivedCount: 0,
        onSignOut: () => {},
        children: createElement(AccountDownloadView, { platform: 'windows', locale: 'zh' }),
      }),
    ),
  );
  assert.match(downloadHtml, /data-account-layout="download"/);
  assert.ok(!downloadHtml.includes('ac-settings-sidebar'));
  assert.ok(downloadHtml.includes('id="preview-scope"'), '/account/download reuses the shared landing download hero');
  assert.ok(downloadHtml.includes('id="download-desktop"'), '/account/download reuses the shared landing platform card');
  assert.ok(downloadHtml.includes('id="download-onboarding-heading"'), '/account/download reuses the shared landing onboarding steps');
  assert.ok(downloadHtml.includes(`href="${NIMI_MACOS_DOWNLOAD_URL}"`));
  assert.ok(downloadHtml.includes(`href="${NIMI_WINDOWS_DOWNLOAD_URL}"`));
  const winWarningIdx = downloadHtml.indexOf('id="preview-warning"');
  const winExeIdx = downloadHtml.indexOf(`href="${NIMI_WINDOWS_DOWNLOAD_URL}"`);
  assert.ok(winWarningIdx > 0 && winExeIdx > winWarningIdx, 'Windows Authenticode/SmartScreen warning precedes Windows .exe link in /account/download');
  assert.equal(accountReturnTo('?returnTo=%2Faccount%2Fdownload'), '/account/download');
});

test('my host view renders honest standby state, past vs future eligibility, unbound onboarding, and reinitialize diff', () => {
  const noop = () => {};
  const boundSnapshot = {
    accountId: 'u-1',
    serverTime: '2026-11-24T07:00:00.000Z',
    binding: {
      bindingId: 'b-1',
      runtimeId: 'rt-1',
      publicKey: 'pk-1',
      displayName: 'Harness Source Dev',
      validAfter: '2026-11-19T05:09:18.000Z',
    },
  };

  const standbyHtml = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      {},
      createElement(AccountRuntimeView, {
        locale: 'zh',
        platform: 'macos',
        userHandle: 'halliday',
        snapshot: boundSnapshot,
        intent: null,
        loading: false,
        working: false,
        error: null,
        completed: false,
        verifyAgain: false,
        nowMs: Date.parse('2026-11-24T07:00:00.000Z'),
        onRefresh: noop,
        onConfirm: noop,
        onCancelIntent: noop,
        onVerifyAgain: noop,
      }),
    ),
  );
  assert.match(standbyHtml, /data-host-view="bound"/);
  assert.match(standbyHtml, /data-host-phase="idle"/);
  assert.ok(standbyHtml.includes('Harness Source Dev'));
  assert.ok(standbyHtml.includes('已绑定 · 未直连'), 'Binding without direct connection never fakes online or AI readiness');
  assert.ok(standbyHtml.includes('已具备远程接入资格'), 'Past validAfter renders as calm eligibility metadata');
  assert.ok(standbyHtml.includes('href="/account"'));
  assert.ok(standbyHtml.includes('ac-host-refresh'), 'Refresh action is integrated into the page header');

  const pendingEligibilityHtml = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      {},
      createElement(AccountRuntimeView, {
        locale: 'zh',
        platform: 'macos',
        snapshot: {
          ...boundSnapshot,
          binding: { ...boundSnapshot.binding, validAfter: '2026-11-24T07:01:00.000Z' },
        },
        intent: null,
        loading: false,
        working: false,
        error: null,
        completed: false,
        verifyAgain: false,
        nowMs: Date.parse('2026-11-24T07:00:00.000Z'),
        onRefresh: noop,
        onConfirm: noop,
        onCancelIntent: noop,
        onVerifyAgain: noop,
      }),
    ),
  );
  assert.ok(pendingEligibilityHtml.includes('ac-host-fact--pending'));
  assert.ok(pendingEligibilityHtml.includes('远程接入最早生效时间'));

  const unboundHtml = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      {},
      createElement(AccountRuntimeView, {
        locale: 'zh',
        platform: 'macos',
        userHandle: 'halliday',
        snapshot: { accountId: 'u-1', serverTime: '2026-11-24T07:00:00.000Z', binding: null },
        intent: null,
        loading: false,
        working: false,
        error: null,
        completed: false,
        verifyAgain: false,
        onRefresh: noop,
        onConfirm: noop,
        onCancelIntent: noop,
        onVerifyAgain: noop,
      }),
    ),
  );
  assert.match(unboundHtml, /data-host-view="unbound"/);
  assert.ok(unboundHtml.includes('@halliday'));
  assert.ok(unboundHtml.includes(`href="${NIMI_MACOS_DOWNLOAD_URL}"`));

  const reinitHtml = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      {},
      createElement(AccountRuntimeView, {
        locale: 'zh',
        platform: 'macos',
        snapshot: boundSnapshot,
        intent: {
          intentId: 'intent-1',
          expectedAccountId: 'u-1',
          operation: 'reinitialize',
          displayName: 'Studio Mac Mini',
          runtimeId: 'rt-2',
          confirmationUrl: 'https://nimi.ai/account/runtime?intent=intent-1',
          expiresAt: '2026-11-24T07:10:00.000Z',
        },
        loading: false,
        working: false,
        error: '请重新登录验证账号所有权，再确认本次请求。',
        completed: false,
        verifyAgain: true,
        onRefresh: noop,
        onConfirm: noop,
        onCancelIntent: noop,
        onVerifyAgain: noop,
      }),
    ),
  );
  assert.match(reinitHtml, /data-host-view="intent"/);
  assert.ok(reinitHtml.includes('Harness Source Dev'));
  assert.ok(reinitHtml.includes('Studio Mac Mini'));
  assert.ok(reinitHtml.includes('旧配置与本地数据不会迁移'));
  assert.ok(reinitHtml.includes('重新验证账号'));
});

test('direct connectivity alone never claims ordinary service or maintenance', () => {
  assert.equal(deriveLivePhase(true, 'connected'), 'connected');
  assert.equal(deriveLivePhase(true, 'maintenance'), 'maintenance');
  assert.equal(deriveLivePhase(true, 'running'), 'running');
  assert.equal(deriveLivePhase(false, 'closed'), 'idle');
  for (const [state, label] of [
    ['connected', '已直连 · 服务状态待确认'],
    ['running', '已直连 · 服务运行中'],
    ['maintenance', '已直连 · 维护模式'],
  ] as const) {
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(AccountRuntimeView, {
      locale: 'zh', platform: 'macos',
      snapshot: { accountId: 'a', serverTime: '', binding: {
        bindingId: 'b', runtimeId: 'rt', publicKey: 'pk', displayName: 'PC', validAfter: '',
      } },
      intent: null, loading: false, working: false, error: null, completed: false, verifyAgain: false,
      liveSummary: { phase: deriveLivePhase(true, state), connectedPeers: null },
      onRefresh: noop, onConfirm: noop, onCancelIntent: noop, onVerifyAgain: noop,
    })));
    assert.ok(html.includes(label));
  }
});

test('remote runtime manager view covers non-HTTPS unavailability, ready standby, and live console controls', () => {
  const noop = () => {};

  const unavailableHtml = renderToStaticMarkup(
    createElement(AccountRuntimeManagerView, {
      locale: 'zh',
      ready: false,
      connected: false,
      busy: false,
      state: '',
      error: null,
      access: null,
      selectedAppId: '',
      pendingPauseClientId: null,
      confirmingStop: false,
      onConnect: noop,
      onRefreshState: noop,
      onDisconnect: noop,
      onRequestToggleSource: noop,
      onConfirmPauseSelf: noop,
      onCancelPauseSelf: noop,
      onSelectApp: noop,
      onRequestStop: noop,
      onConfirmStop: noop,
      onCancelStop: noop,
    }),
  );
  assert.match(unavailableHtml, /data-manager-mode="standby"/);
  assert.match(unavailableHtml, /data-manager-ready="false"/);
  assert.ok(unavailableHtml.includes('此部署尚未配置 HTTPS 官方管理来源'));
  assert.ok(unavailableHtml.includes('ac-button--unavailable'));
  assert.match(unavailableHtml, /disabled=""/);

  const connectedHtml = renderToStaticMarkup(
    createElement(AccountRuntimeManagerView, {
      locale: 'zh',
      ready: true,
      connected: true,
      busy: false,
      state: 'connected',
      error: null,
      currentClientId: 'mgr-client',
      access: {
        enabled: true,
        bindingId: 'b-1',
        connectionState: 3,
        connectedPeers: 2,
        reasonCode: '',
        connections: [{ connectionId: 'c-1', clientId: 'mgr-client' }],
        sources: [
          {
            clientId: 'mgr-client',
            appId: 'nimi.web.manager',
            displayName: 'Nimi Web Manager',
            origin: 'https://nimi.ai',
            sourceRevision: '1',
            officialManager: true,
            appAccess: [],
            capabilityContractRefs: [],
            state: RemoteSourceAccessState.ALLOWED,
            pendingRequestId: '',
          },
          {
            clientId: 'app-zhiyu',
            appId: 'nimi.zhiyu',
            displayName: '织羽',
            origin: 'https://zhiyu.nimi.xyz',
            sourceRevision: '2',
            officialManager: false,
            appAccess: [],
            capabilityContractRefs: ['text.generate', 'speech.synthesize'],
            state: RemoteSourceAccessState.ALLOWED,
            pendingRequestId: '',
          },
          {
            clientId: 'app-pending',
            appId: 'nimi.pending',
            displayName: 'New App',
            origin: 'https://new.nimi.xyz',
            sourceRevision: '1',
            officialManager: false,
            appAccess: [],
            capabilityContractRefs: [],
            state: RemoteSourceAccessState.PENDING,
            pendingRequestId: 'req-1',
          },
        ],
      },
      selectedAppId: 'nimi.zhiyu',
      pendingPauseClientId: 'mgr-client',
      confirmingStop: true,
      onConnect: noop,
      onRefreshState: noop,
      onDisconnect: noop,
      onRequestToggleSource: noop,
      onConfirmPauseSelf: noop,
      onCancelPauseSelf: noop,
      onSelectApp: noop,
      onRequestStop: noop,
      onConfirmStop: noop,
      onCancelStop: noop,
      modelConfigSlot: createElement('div', { 'data-mock-model-config': 'true' }, 'ModelConfig'),
    }),
  );
  assert.match(connectedHtml, /data-manager-mode="connected"/);
  assert.ok(connectedHtml.includes('已直连主设备，服务状态尚未确认。'));
  assert.ok(!connectedHtml.includes('普通服务正在运行'));
  assert.ok(connectedHtml.includes('Nimi Web Manager'));
  assert.ok(connectedHtml.includes('官方管理端'));
  assert.ok(connectedHtml.includes('当前会话'));
  assert.ok(connectedHtml.includes('1 活跃'));
  assert.ok(connectedHtml.includes('确认暂停并断开'), 'Pausing active manager uses inline confirmation');
  assert.ok(connectedHtml.includes('在 PC Home 确认'));
  assert.ok(connectedHtml.includes('织羽'));
  assert.ok(connectedHtml.includes('2 项能力'));
  assert.ok(connectedHtml.includes('data-mock-model-config="true"'));
  assert.ok(connectedHtml.includes('确认停止服务'), 'Stopping primary host uses inline two-step confirmation');
});

test('AccountAvatar renders Scheme A deterministic mesh monogram without photo and skips mesh when photo exists', () => {
  const fallbackHtml = renderToStaticMarkup(
    createElement(AccountAvatar, {
      user: { id: 'acc-halliday', displayName: 'Halliday', handle: 'halliday' },
      size: 'large',
    }),
  );
  assert.match(fallbackHtml, /data-nimi-avatar-mesh="(glacier|mint|apricot|sage|rose|amber|periwinkle|slate)"/);
  assert.ok(fallbackHtml.includes('>H<'));

  const cjkFallbackHtml = renderToStaticMarkup(
    createElement(AccountAvatar, {
      user: { id: 'acc-lin', displayName: '林夏' },
      size: 'small',
    }),
  );
  assert.match(cjkFallbackHtml, /data-nimi-avatar-mesh=/);
  assert.ok(cjkFallbackHtml.includes('>林<'));

  const photoHtml = renderToStaticMarkup(
    createElement(AccountAvatar, {
      user: { id: 'acc-halliday', displayName: 'Halliday', avatarUrl: 'https://cdn.nimi.test/avatar.png' },
      size: 'normal',
    }),
  );
  assert.doesNotMatch(photoHtml, /data-nimi-avatar-mesh=/);
  assert.ok(photoHtml.includes('https://cdn.nimi.test/avatar.png'));
});
