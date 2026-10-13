import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n';
import { WorldPeopleArchivePage } from '../src/shell/renderer/features/world/world-detail-people-gallery';
import type { WorldCharacter } from '../src/shell/renderer/features/world/world-detail-types';
import { readyPeopleCatalog } from './world-people-catalog-fixture';

(globalThis as { React?: typeof React }).React = React;
const roster: WorldCharacter[] = ['姚燧', '同恕', '倪瓒'].map((name, index) => ({
  id: `person-${index}`, name, handle: `person-${index}`, bio: `${name} 的生平。`,
  sourceRef: { kind: 'worldCharacter', id: `person-${index}`, worldId: 'world-1', worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: `entity-${index}` }, sourceHash: 'a'.repeat(64) },
  sourceKind: 'worldCharacter', relation: { state: index === 1 ? 'connected' : 'connectable' },
  importance: 'SECONDARY', createdAt: '2026-01-01T00:00:00.000Z',
}));
const render = (catalog = readyPeopleCatalog(roster.length), characters = roster) => new JSDOM(renderToStaticMarkup(<WorldPeopleArchivePage characters={characters} catalog={catalog} onBack={() => {}} onSelect={() => {}} />)).window.document;
test.before(async () => { await initI18n(); await changeLocale('en'); });

test('people browsing preserves Realm order without local-partner grouping or primary actions', () => {
  const document = render();
  assert.deepEqual(Array.from(document.querySelectorAll('h3')).map((heading) => heading.textContent), roster.map((person) => person.name));
  assert.equal(document.querySelectorAll('button[aria-label^="View "]').length, roster.length);
  assert.doesNotMatch(document.body.textContent!, /Become my partner|Chat now|Connected|WorldDetail\./);
});

test('server population, query and next page remain distinct from loaded rows', () => {
  const document = render(readyPeopleCatalog(105, { hasMore: true, query: '姚' }));
  assert.ok(document.body.textContent?.includes('105 people'));
  assert.ok(document.body.textContent?.includes('3 of 105 loaded'));
  assert.equal(document.querySelector('input')?.value, '姚');
  assert.ok(document.body.textContent?.includes('同恕'), 'do not filter a server page again');
});

test('first-page loading, offline and failure never claim an empty world', () => {
  for (const status of ['loading', 'offline', 'error'] as const) {
    const document = render(readyPeopleCatalog(0, { status, offline: status === 'offline' }), []);
    assert.ok(document.querySelector(`[data-testid="world-people-catalog-${status}"]`));
    assert.doesNotMatch(document.body.textContent!, /No public characters|0 people/);
  }
  assert.ok(render(readyPeopleCatalog(0), []).body.textContent?.includes('No public characters'));
  assert.ok(render(readyPeopleCatalog(0, { query: 'absent' }), []).body.textContent?.includes('No characters match'));
});

test('next-page failures retain people and waiting pages disable the action', () => {
  const failed = render(readyPeopleCatalog(105, { hasMore: true, loadMoreFailed: true }));
  assert.equal(failed.querySelectorAll('[data-testid="world-character-card"]').length, roster.length);
  assert.equal(failed.querySelector('[data-testid="world-detail-people-load-more"] button')?.textContent?.trim(), 'Try again');
  const waiting = render(readyPeopleCatalog(105, { hasMore: true, loadMorePaused: true, offline: true }));
  assert.equal(waiting.querySelector('[data-testid="world-detail-people-load-more"] button')?.hasAttribute('disabled'), true);
  assert.ok(waiting.body.textContent?.includes('More people will load when'));
});
