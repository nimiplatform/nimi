import assert from 'node:assert/strict';
import test from 'node:test';

import * as realm from '../../src/realm/index.js';
import {
  AuthTwoFactorVerifyInput,
  MeTwoFactorPrepareOutput,
  MeTwoFactorVerifyInput,
  Realm,
} from '../../src/realm/index.js';

test('realm facade exposes naming-normalized symbols', () => {
  assert.equal(typeof Realm, 'function');
  assert.equal(typeof ({} as AuthTwoFactorVerifyInput), 'object');
  assert.equal(typeof ({} as MeTwoFactorVerifyInput), 'object');
  assert.equal(typeof ({} as MeTwoFactorPrepareOutput), 'object');
});

test('realm facade does not expose legacy naming symbols', () => {
  assert.equal('openApiRequest' in realm, false);
  assert.equal('OpenAPI' in realm, false);
  assert.equal('ApiError' in realm, false);
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
