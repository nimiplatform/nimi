import type { RealmModel } from '@nimiplatform/sdk/realm';

type CheckEmailResponseDto = RealmModel<'CheckEmailResponseDto'>;
type OAuthLoginResultDto = RealmModel<'OAuthLoginResultDto'>;

export type EmailEntryRoute =
  | 'register_with_otp'
  | 'login_with_otp'
  | 'login_with_password';

export function resolveEmailEntryRoute(result: CheckEmailResponseDto): EmailEntryRoute {
  if (result.available) {
    return 'register_with_otp';
  }
  return 'login_with_otp';
}

export function shouldPromptPasswordSetupAfterEmailOtp(
  result: Pick<OAuthLoginResultDto, 'tokens'>,
): boolean {
  return result.tokens?.user?.hasPassword === false;
}
