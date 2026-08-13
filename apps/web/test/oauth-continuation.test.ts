import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isFreshAccountSelection,
  isFreshOauthContinuation,
  readValidatedOauthNext,
} from '../src/auth/oauth-continuation.js';

test('oauth continuation accepts only the admitted Realm authorize transaction', () => {
  const previous = process.env.VITE_NIMI_REALM_BASE_URL;
  process.env.VITE_NIMI_REALM_BASE_URL = 'https://realm.nimi.test';
  try {
    const admitted = 'https://realm.nimi.test/api/auth/oauth/authorize?state=s1&prompt=login&presence_purpose=nimi.account.switch';
    const search = `?fresh_oauth=1&oauth_next=${encodeURIComponent(admitted)}`;
    assert.equal(readValidatedOauthNext(search), admitted);
    assert.equal(isFreshOauthContinuation(search), true);
    assert.equal(isFreshAccountSelection(search), true);
    const reauth = 'https://realm.nimi.test/api/auth/oauth/authorize?state=s1&prompt=login&presence_purpose=shijing.profile.reveal';
    const reauthSearch = `?fresh_oauth=1&oauth_next=${encodeURIComponent(reauth)}`;
    assert.equal(isFreshOauthContinuation(reauthSearch), true);
    assert.equal(isFreshAccountSelection(reauthSearch), false);
    assert.equal(readValidatedOauthNext(`?oauth_next=${encodeURIComponent('https://attacker.test/oauth/authorize?state=s1')}`), null);
    assert.equal(readValidatedOauthNext(`?oauth_next=${encodeURIComponent('https://realm.nimi.test/api/auth/oauth/authorize')}`), null);
    assert.equal(readValidatedOauthNext(`?oauth_next=${encodeURIComponent('https://realm.nimi.test/redirect/oauth/authorize?state=s1')}`), null);
    assert.equal(readValidatedOauthNext(`?oauth_next=${encodeURIComponent(`${admitted}#code=forbidden`)}`), null);

    process.env.VITE_NIMI_REALM_BASE_URL = 'http://realm.nimi.test';
    assert.equal(
      readValidatedOauthNext(`?oauth_next=${encodeURIComponent('http://realm.nimi.test/api/auth/oauth/authorize?state=s1')}`),
      null,
    );

    process.env.VITE_NIMI_REALM_BASE_URL = 'http://127.0.0.1:3002';
    const loopback = 'http://127.0.0.1:3002/api/auth/oauth/authorize?state=s2';
    assert.equal(readValidatedOauthNext(`?oauth_next=${encodeURIComponent(loopback)}`), loopback);
  } finally {
    if (previous === undefined) delete process.env.VITE_NIMI_REALM_BASE_URL;
    else process.env.VITE_NIMI_REALM_BASE_URL = previous;
  }
});
