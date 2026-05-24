import type { RealmModel } from '@nimiplatform/kit/core/sdk-contract';

type CheckEmailResponseDto = RealmModel<'CheckEmailResponseDto'>;
type OAuthLoginResultDto = RealmModel<'OAuthLoginResultDto'>;

export type EmailEntryRoute =
  | 'register_with_otp'
  | 'login_with_otp'
  | 'login_with_password';

export function resolveEmailEntryRoute(result: CheckEmailResponseDto): EmailEntryRoute {
  return result.entryRoute;
}

export function shouldPromptPasswordSetupAfterEmailOtp(
  result: Pick<OAuthLoginResultDto, 'tokens'>,
): boolean {
  return result.tokens?.user?.hasPassword === false;
}
