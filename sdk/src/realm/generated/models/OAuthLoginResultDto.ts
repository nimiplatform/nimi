/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AuthTokensDto } from './AuthTokensDto';
export type OAuthLoginResultDto = {
    blockedReason?: string | null;
    loginState: OAuthLoginResultDto.loginState;
    tempToken?: string | null;
    tokens?: AuthTokensDto | null;
};
export namespace OAuthLoginResultDto {
    export enum loginState {
        OK = 'ok',
        NEEDS_ONBOARDING = 'needs_onboarding',
        NEEDS_2FA = 'needs_2fa',
        BLOCKED = 'blocked',
    }
}

