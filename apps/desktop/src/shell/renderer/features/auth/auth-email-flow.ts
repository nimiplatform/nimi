import type { CheckEmailResponseDto, OAuthLoginResultDto } from '@nimiplatform/sdk/realm';

export type EmailEntryRoute =
  | 'register_with_otp'
  | 'login_with_otp'
  | 'login_with_password';

export function resolveEmailEntryRoute(result: CheckEmailResponseDto): EmailEntryRoute {
  if (result.available) {
    return 'register_with_otp';
  }

  if (result.hasPassword === false) {
    return 'login_with_otp';
  }

  return 'login_with_password';
}

export function shouldPromptPasswordSetupAfterEmailOtp(
  result: Pick<OAuthLoginResultDto, 'tokens'>,
): boolean {
  return result.tokens?.user?.hasPassword === false;
}
