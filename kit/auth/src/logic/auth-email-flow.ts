import {
  readNimiRealmOAuthLoginTokens,
  type NimiRealmOAuthLoginResult,
  type RealmModel,
} from '@nimiplatform/kit/core/sdk-contract';

type CheckEmailResponseDto = RealmModel<'CheckEmailResponseDto'>;

export type EmailEntryRoute =
  | 'register_with_otp'
  | 'login_with_otp'
  | 'login_with_password';

export function resolveEmailEntryRoute(result: CheckEmailResponseDto): EmailEntryRoute {
  return result.entryRoute;
}

export function shouldPromptPasswordSetupAfterEmailOtp(
  result: Pick<NimiRealmOAuthLoginResult, 'tokens'>,
): boolean {
  return readNimiRealmOAuthLoginTokens(result)?.user?.hasPassword === false;
}
