import assert from 'node:assert/strict';
import test from 'node:test';

import * as realm from '../../src/realm/index.js';
import {
  Realm,
} from '../../src/realm/index.js';
import type {
  RealmModel,
  RealmServiceResult,
} from '../../src/realm/index.js';

type _AuthTwoFactorVerifyInput = RealmModel<'AuthTwoFactorVerifyInput'>;
type _MeTwoFactorPrepareOutput = RealmModel<'MeTwoFactorPrepareOutput'>;
type _GetMeResult = RealmServiceResult<'MeService', 'getMe'>;

test('realm facade exposes naming-normalized public helpers', () => {
  assert.equal(typeof Realm, 'function');
  assert.equal(typeof ({} as _AuthTwoFactorVerifyInput), 'object');
  assert.equal(typeof ({} as _MeTwoFactorPrepareOutput), 'object');
  assert.equal(typeof ({} as _GetMeResult), 'object');
  assert.equal(typeof realm.OAuthProvider, 'object');
  assert.equal(typeof realm.PostMediaType, 'object');
});

test('realm facade does not expose removed DTO symbols or legacy naming symbols', () => {
  assert.equal('AuthTwoFactorVerifyInput' in realm, false);
  assert.equal('MeTwoFactorVerifyInput' in realm, false);
  assert.equal('MeTwoFactorPrepareOutput' in realm, false);
  assert.equal('UserPrivateDto' in realm, false);
  assert.equal('PostDto' in realm, false);
  assert.equal('openApiRequest' in realm, false);
  assert.equal('OpenAPI' in realm, false);
  assert.equal('ApiError' in realm, false);
  assert.equal('sendAgentChannelMessage' in realm, false);
  assert.equal('MeTwoFactorService' in realm, false);
  assert.equal('SocialDefaultVisibilityService' in realm, false);
  assert.equal('SocialAttributesService' in realm, false);
  assert.equal('Me2FaService' in realm, false);
  assert.equal('Auth2faVerifyDto' in realm, false);
  assert.equal('Me2faVerifyDto' in realm, false);
  assert.equal('Me2faPrepareResponseDto' in realm, false);
  assert.equal('SocialV1DefaultVisibilityService' in realm, false);
  assert.equal('SocialFourDimensionalAttributesService' in realm, false);
});
