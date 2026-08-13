import type { RealmModel } from '@nimiplatform/kit/core/sdk-contract';

type CheckEmailResponseDto = RealmModel<'CheckEmailResponseDto'>;

export type EmailEntryRoute =
  | 'register_with_otp'
  | 'login_with_otp'
  | 'login_with_password';

export function resolveEmailEntryRoute(result: CheckEmailResponseDto): EmailEntryRoute {
  return result.entryRoute;
}
