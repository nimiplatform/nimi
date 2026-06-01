import {
  checkRealmAuthEmail,
  loginRealmAuthPassword,
  loginRealmOAuth,
  toRealmOAuthLoginResultDto,
} from '@nimiplatform/sdk/realm';

export type TesterRealmAuthProjection = {
  entryRoute: string;
  passwordLoginState: string;
  oauthAccessToken: string;
  projectedLoginState: string;
};

export async function loadTesterRealmAuthProjection(): Promise<TesterRealmAuthProjection> {
  const callRealm = async <T>(task: (realm: {
    services: {
      AuthService: {
        checkEmail: (input: { email: string }) => Promise<unknown>;
        passwordLogin: (input: { identifier: string; password: string }) => Promise<unknown>;
        oauthLogin: (input: { provider: string; accessToken: string }) => Promise<unknown>;
      };
    };
  }) => Promise<T>) =>
    task({
      services: {
        AuthService: {
          checkEmail: async () => ({ available: false, entryRoute: 'login_with_password' }),
          passwordLogin: async () => ({
            loginState: 'ok',
            tokens: { accessToken: 'tester-password-access', expiresIn: 3600, tokenType: 'Bearer' },
          }),
          oauthLogin: async (input) => ({
            loginState: 'ok',
            tokens: { accessToken: `tester-${input.provider.toLowerCase()}-access`, expiresIn: 3600, tokenType: 'Bearer' },
          }),
        },
      },
    });

  const checkEmail = await checkRealmAuthEmail(callRealm as never, 'tester@example.test');
  const passwordLogin = await loginRealmAuthPassword(
    callRealm as never,
    'tester@example.test',
    'password',
    'Tester password login failed',
  );
  const oauthLogin = await loginRealmOAuth(callRealm as never, 'GOOGLE' as never, 'oauth-token', 'Tester OAuth login failed');
  const projected = toRealmOAuthLoginResultDto({ loginState: 'needs_2fa', tempToken: 'tester-temp' });

  return {
    entryRoute: checkEmail.entryRoute,
    passwordLoginState: passwordLogin.loginState,
    oauthAccessToken: oauthLogin.tokens?.accessToken || 'none',
    projectedLoginState: projected.loginState,
  };
}
