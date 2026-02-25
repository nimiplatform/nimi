/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Auth2faVerifyDto } from '../models/Auth2faVerifyDto';
import type { AuthTokensDto } from '../models/AuthTokensDto';
import type { BindEmailDto } from '../models/BindEmailDto';
import type { ChangeEmailDto } from '../models/ChangeEmailDto';
import type { EmailOtpRequestDto } from '../models/EmailOtpRequestDto';
import type { EmailOtpResponseDto } from '../models/EmailOtpResponseDto';
import type { EmailOtpVerifyDto } from '../models/EmailOtpVerifyDto';
import type { OAuthLoginDto } from '../models/OAuthLoginDto';
import type { OAuthLoginResultDto } from '../models/OAuthLoginResultDto';
import type { PasswordLoginDto } from '../models/PasswordLoginDto';
import type { PasswordRegisterDto } from '../models/PasswordRegisterDto';
import type { RefreshTokenDto } from '../models/RefreshTokenDto';
import type { UpdatePasswordRequestDto } from '../models/UpdatePasswordRequestDto';
import type { WalletChallengeDto } from '../models/WalletChallengeDto';
import type { WalletChallengeResponseDto } from '../models/WalletChallengeResponseDto';
import type { WalletLoginDto } from '../models/WalletLoginDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AuthService {
    /**
     * Verify 2FA
     * @param requestBody
     * @returns AuthTokensDto
     * @throws ApiError
     */
    public static verify2Fa(
        requestBody: Auth2faVerifyDto,
    ): CancelablePromise<AuthTokensDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/2fa/verify',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Request email OTP
     * @param requestBody
     * @returns EmailOtpResponseDto
     * @throws ApiError
     */
    public static requestEmailOtp(
        requestBody: EmailOtpRequestDto,
    ): CancelablePromise<EmailOtpResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/email/otp/request',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Verify email OTP and login
     * @param requestBody
     * @returns OAuthLoginResultDto
     * @throws ApiError
     */
    public static verifyEmailOtp(
        requestBody: EmailOtpVerifyDto,
    ): CancelablePromise<OAuthLoginResultDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/email/otp/verify',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Logout
     * @param requestBody
     * @returns any Logout success
     * @throws ApiError
     */
    public static logout(
        requestBody: RefreshTokenDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/logout',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Change email
     * @param requestBody
     * @returns void
     * @throws ApiError
     */
    public static changeEmail(
        requestBody: ChangeEmailDto,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/auth/me/email',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Bind email
     * @param requestBody
     * @returns void
     * @throws ApiError
     */
    public static bindEmail(
        requestBody: BindEmailDto,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/me/email',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Update password
     * @param requestBody
     * @returns void
     * @throws ApiError
     */
    public static updatePassword(
        requestBody: UpdatePasswordRequestDto,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/auth/me/password',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Link OAuth
     * @param requestBody
     * @returns any OAuth linked
     * @throws ApiError
     */
    public static linkOauth(
        requestBody: OAuthLoginDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/oauth/link',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * OAuth login
     * @param requestBody
     * @returns OAuthLoginResultDto
     * @throws ApiError
     */
    public static oauthLogin(
        requestBody: OAuthLoginDto,
    ): CancelablePromise<OAuthLoginResultDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/oauth/login',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Unlink OAuth
     * @param provider
     * @returns void
     * @throws ApiError
     */
    public static unlinkOauth(
        provider: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/auth/oauth/{provider}',
            path: {
                'provider': provider,
            },
        });
    }
    /**
     * Password login
     * @param requestBody
     * @returns OAuthLoginResultDto
     * @throws ApiError
     */
    public static passwordLogin(
        requestBody: PasswordLoginDto,
    ): CancelablePromise<OAuthLoginResultDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/password/login',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Password register
     * @param requestBody
     * @returns OAuthLoginResultDto
     * @throws ApiError
     */
    public static passwordRegister(
        requestBody: PasswordRegisterDto,
    ): CancelablePromise<OAuthLoginResultDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/password/register',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Refresh token
     * @param requestBody
     * @returns AuthTokensDto
     * @throws ApiError
     */
    public static refreshToken(
        requestBody: RefreshTokenDto,
    ): CancelablePromise<AuthTokensDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/refresh',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Wallet challenge
     * @param requestBody
     * @returns WalletChallengeResponseDto
     * @throws ApiError
     */
    public static walletChallenge(
        requestBody: WalletChallengeDto,
    ): CancelablePromise<WalletChallengeResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/wallet/challenge',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Wallet login
     * @param requestBody
     * @returns OAuthLoginResultDto
     * @throws ApiError
     */
    public static walletLogin(
        requestBody: WalletLoginDto,
    ): CancelablePromise<OAuthLoginResultDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/wallet/login',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
