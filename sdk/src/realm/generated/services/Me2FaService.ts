/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Me2faPrepareResponseDto } from '../models/Me2faPrepareResponseDto';
import type { Me2faVerifyDto } from '../models/Me2faVerifyDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class Me2FaService {
    /**
     * Disable 2FA
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static disable2Fa(
        requestBody: Me2faVerifyDto,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/me/2fa/disable',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Enable 2FA
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static enable2Fa(
        requestBody: Me2faVerifyDto,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/me/2fa/enable',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Prepare 2FA
     * @returns Me2faPrepareResponseDto
     * @throws ApiError
     */
    public static prepare2Fa(): CancelablePromise<Me2faPrepareResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/auth/me/2fa/prepare',
        });
    }
}
