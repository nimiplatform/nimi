import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEditableProfileDraft, parseProfileList, previewProfileDraft, profileDraftPatch, profileDraftValidation } from '../src/shell/renderer/features/profile/profile-edit-model.js';
import { toHumanProfileData } from '../src/shell/renderer/features/profile/profile-model.js';

const profile = toHumanProfileData({ id: 'person-a', handle: 'alice', displayName: 'Alice', bio: 'Before', city: 'Paris', languages: ['en'], tags: ['books'] });

test('editing a field submits no unchanged or omitted profile fields', () => {
  const baseline = buildEditableProfileDraft(profile);
  assert.deepEqual(profileDraftPatch(baseline, { ...baseline, bio: '  After  ' }), { bio: 'After' });
  assert.deepEqual(profileDraftPatch(baseline, { ...baseline, city: '' }), { city: null });
  assert.deepEqual(profileDraftPatch(baseline, { ...baseline, avatarResourceId: 'media-a', avatarUrl: 'https://media.test/signed' }), { avatarResourceId: 'media-a' });
});

test('public preview uses the draft without mutating saved identity or clearing input', () => {
  const draft = { ...buildEditableProfileDraft(profile), bio: 'Draft', tags: 'books，旅行、books\nNimi' };
  const preview = previewProfileDraft(profile, draft);
  assert.equal(preview.bio, 'Draft');
  assert.equal(profile.bio, 'Before');
  assert.equal(draft.bio, 'Draft');
  assert.equal(preview.id, 'person-a');
  assert.deepEqual(preview.tags, ['books', '旅行', 'Nimi']);
  assert.deepEqual(parseProfileList('英语，中文、英语\n日本語'), ['英语', '中文', '日本語']);
});

test('validation follows owner limits and preserves optional empty fields', () => {
  const baseline = buildEditableProfileDraft(profile);
  assert.equal(profileDraftValidation({ ...baseline, bio: 'a'.repeat(2000), displayName: 'a'.repeat(500), gender: '' }), null);
  assert.equal(profileDraftValidation({ ...baseline, displayName: ' ' }), 'name');
  assert.equal(profileDraftValidation({ ...baseline, bio: 'a'.repeat(2001) }), 'length');
  assert.equal(profileDraftValidation({ ...baseline, languages: 'a'.repeat(33) }), 'languages');
  assert.equal(profileDraftValidation({ ...baseline, tags: Array.from({ length: 21 }, (_, i) => String(i)).join(',') }), 'tags');
});
