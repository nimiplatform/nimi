import {
  checkNimiRealmAuthEmail,
  loginNimiRealmAuthPassword,
  loginNimiRealmOAuth,
  normalizeNimiRealmOAuthLoginResult,
} from '@nimiplatform/sdk/realm';

export type TesterRealmAuthProjection = {
  entryRoute: string;
  passwordLoginState: string;
  oauthAccessToken: string;
  projectedLoginState: string;
};

export async function loadTesterRealmAuthProjection(): Promise<TesterRealmAuthProjection> {
  const realm = {
    auth: {
      checkEmail: async () => ({ available: false, entryRoute: 'login_with_password' }),
      passwordLogin: async () => ({
        loginState: 'ok',
        tokens: { accessToken: 'tester-password-access', expiresIn: 3600, tokenType: 'Bearer' },
      }),
      oauthLogin: async (input: { body: { provider: string } }) => ({
        loginState: 'ok',
        tokens: { accessToken: `tester-${input.body.provider.toLowerCase()}-access`, expiresIn: 3600, tokenType: 'Bearer' },
      }),
    },
  };

  const checkEmail = await checkNimiRealmAuthEmail(realm as never, 'tester@example.test');
  const passwordLogin = await loginNimiRealmAuthPassword(
    realm as never,
    'tester@example.test',
    'password',
    { metadata: { callerId: 'tester.realm.auth.password' } },
  );
  const oauthLogin = await loginNimiRealmOAuth(
    realm as never,
    'GOOGLE' as never,
    'oauth-token',
    { metadata: { callerId: 'tester.realm.auth.oauth' } },
  );
  const projected = normalizeNimiRealmOAuthLoginResult({ loginState: 'needs_2fa', tempToken: 'tester-temp' });

  return {
    entryRoute: checkEmail.entryRoute,
    passwordLoginState: passwordLogin.loginState,
    oauthAccessToken: oauthLogin.tokens?.accessToken || 'none',
    projectedLoginState: projected.loginState,
  };
}
