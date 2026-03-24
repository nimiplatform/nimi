import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { toSafeBackgroundImage } from '../src/shell/renderer/features/explore/explore-cards';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const addFriendModalSource = readSource('../src/shell/renderer/features/home/add-friend-modal.tsx');
const addContactModalSource = readSource('../src/shell/renderer/features/contacts/add-contact-modal.tsx');
const exploreCardsSource = readSource('../src/shell/renderer/features/explore/explore-cards.tsx');
const explorePanelSource = readSource('../src/shell/renderer/features/explore/explore-panel.tsx');
const contactsViewSource = readSource('../src/shell/renderer/features/contacts/contacts-view.tsx');
const contactsFriendRequestsSource = readSource('../src/shell/renderer/features/contacts/contacts-friend-requests.tsx');
const postCardSource = readSource('../src/shell/renderer/features/home/post-card.tsx');

test('top agent cards sanitize banner URLs before interpolating them into background images', () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: {
        href: 'https://app.nimi.example/explore',
      },
    },
    configurable: true,
  });
  try {
    assert.equal(toSafeBackgroundImage('javascript:alert(1)'), null);
    assert.equal(toSafeBackgroundImage('data:text/html,boom'), null);
    assert.equal(
      toSafeBackgroundImage('https://cdn.nimi.example/banner.png'),
      'url("https://cdn.nimi.example/banner.png")',
    );
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
  }
});

test('explore panel keeps agent queries declarative without imperative refetch loops', () => {
  assert.match(explorePanelSource, /queryKey: \['explore-agents', authStatus, selectedCategory, searchText\]/);
  assert.doesNotMatch(explorePanelSource, /agentsQuery\.refetch\(\)/);
});

test('add friend modal forwards the typed greeting message to the add-friend action', () => {
  assert.match(addFriendModalSource, /onAddFriend: \(message\?: string\) => Promise<void>/);
  assert.match(addFriendModalSource, /await onAddFriend\(message\.trim\(\) \|\| undefined\)/);
  assert.match(postCardSource, /dataSync\.requestOrAcceptFriend\(authorId, message\)/);
});

test('add contact modal localizes footer action labels instead of hardcoding English strings', () => {
  assert.match(addContactModalSource, /t\('Contacts\.sending', \{ defaultValue: 'Sending\.\.\.' \}\)/);
  assert.match(addContactModalSource, /t\('Contacts\.addContactTitle', \{ defaultValue: 'Add Contact' \}\)/);
  assert.doesNotMatch(addContactModalSource, /\n\s*Sending\.\.\.\n/);
  assert.doesNotMatch(addContactModalSource, /\n\s*'Add Contact'\n/);
});

test('contacts view no longer relies on a non-null assertion for selected profiles and keeps comments accurate', () => {
  assert.doesNotMatch(contactsViewSource, /selectedProfile!/);
  assert.match(contactsViewSource, /selectedContact && selectedProfile/);
  assert.doesNotMatch(contactsViewSource, /跟踪已接受的好友请求/);
  assert.match(contactsViewSource, /处理联系人侧栏拖拽缩放/);
});

test('contacts friend requests view does not carry an unused React default import', () => {
  assert.doesNotMatch(contactsFriendRequestsSource, /import React from 'react'/);
});
