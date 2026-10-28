import assert from 'node:assert/strict';
import test from 'node:test';
import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { PartnerDirectoryRow } from '../src/shell/renderer/features/agents/partner-directory-row.js';
import { PartnerArtwork } from '../src/shell/renderer/features/agents/partner-media.js';
import type { PartnerDirectoryItem } from '../src/shell/renderer/features/agents/partner-directory-model.js';

(globalThis as { React?: typeof React }).React = React;
type Source = NonNullable<ComponentProps<typeof PartnerArtwork>['source']>;
const sourceRef = { kind: 'personaCharacter' as const, id: 'character', ownerAccountId: 'owner', worldId: 'world', sourceHash: 'a'.repeat(64) };
const partner: PartnerDirectoryItem = { localAgentRef: 'local-agent:a', runtimeSourceRef: 'source-a', displayName: '桑禾',
  lifecycle: AgentLifecycleStatus.ACTIVE, sourceReady: true, sourceRef, createdAt: '2026-10-01T00:00:00Z' };
const source: Source = { sourceRef, displayName: '桑禾', worldName: '河津', summary: '桑家染布铺的掌柜', updated: false,
  media: { assets: { avatar: null, portrait: null, profileCover: null, referenceImage: null, voiceSample: null },
    external: { avatarUrl: 'https://media.example/avatar.webp', portraitUrl: 'https://media.example/portrait.webp', profileCoverUrl: null, referenceImageUrl: null, voiceSampleUrl: null }, unavailableResourceRefs: [] } };
const bindings = { sdk: {} } as DesktopCanonicalRendererBindings;
test.before(async () => { await initI18n(); await changeLocale('zh'); });

function renderRow(record = partner, profile: Source | null = source, accountId = 'owner') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  if (profile) client.setQueryData(['partner-current-source', 'owner', 'realm', record.localAgentRef, record.sourceRef], profile);
  const document = new JSDOM(renderToStaticMarkup(<QueryClientProvider client={client}><DesktopRendererBindingProvider bindings={bindings}>
    <PartnerDirectoryRow partner={record} accountId={accountId} scopeKey="realm" enabled={false} selected onSelect={() => {}} />
  </DesktopRendererBindingProvider></QueryClientProvider>)).window.document;
  client.clear();
  return document;
}

test('sidebar renders the character avatar and summary from the shared source cache', () => {
  const document = renderRow();
  assert.equal(document.querySelector('img')?.src, 'https://media.example/avatar.webp');
  assert.equal(document.querySelector('img')?.alt, '桑禾');
  assert.ok(document.body.textContent?.includes('桑家染布铺的掌柜'));
  assert.equal(document.querySelector('button')?.getAttribute('aria-current'), 'true');
  assert.ok(!document.body.textContent?.includes('创建于'));
});

test('missing optional artwork preserves the partner and paused state; account changes cannot reuse another account image', () => {
  const paused = renderRow({ ...partner, lifecycle: AgentLifecycleStatus.SUSPENDED }, null);
  assert.ok(paused.body.textContent?.includes('桑禾'));
  assert.ok(paused.body.textContent?.includes('已暂停，当前可查看资料'));
  assert.equal(paused.querySelector('img'), null);
  assert.equal(renderRow(partner, source, 'another-account').querySelector('img'), null);
});

test('a portrait-only delivery supplies the sidebar avatar without requesting original media', () => {
  const profile: Source = { ...source, media: { ...source.media, assets: { ...source.media.assets,
    portrait: { id: 'portrait', kind: 'image', externalUrl: null, delivery: {
      resourceId: 'portrait', contentVersion: 'a'.repeat(64), publicationGeneration: 1, policyVersion: 'v1', expiresAt: null,
      previewUrl: null, originalUrl: 'https://media.example/original.png', video: null,
      images: [{ purpose: 'card', families: [{ mimeType: 'image/webp', sources: [{ url: 'https://media.example/card.webp', width: 320, height: 320, mimeType: 'image/webp' }] }] }],
    } },
  } } };
  const document = renderRow(partner, profile);
  assert.equal(document.querySelector('img')?.src, 'https://media.example/card.webp');
  assert.ok(!document.body.innerHTML.includes('original.png'));
});
