import type { OAuthLoginInput } from '../src/index.js';

type Equal<Left, Right> = (
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
);
type Assert<Condition extends true> = Condition;

type OnSuccessHasNoPayload = Assert<Equal<Parameters<OAuthLoginInput['onSuccess']>, []>>;
type OAuthOperationResponseHasNoBearer = Assert<Equal<
  Extract<
    keyof Awaited<ReturnType<OAuthLoginInput['oauthLogin']>>,
    'accessToken' | 'refreshToken' | 'tokens' | 'authorization'
  >,
  never
>>;

export type OAuthLoginPublicContractAssertions =
  | OnSuccessHasNoPayload
  | OAuthOperationResponseHasNoBearer;
