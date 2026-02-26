/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class InvitationsService {
    /**
     * List my invitation codes
     * @returns any List of codes
     * @throws ApiError
     */
    public static invitationControllerListMyCodes(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/invitations',
        });
    }
    /**
     * Generate a new invitation code
     * @returns any Created code
     * @throws ApiError
     */
    public static invitationControllerGenerateCode(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/invitations',
        });
    }
    /**
     * Verify and redeem an invitation code
     * @param requestBody
     * @returns boolean Verification success
     * @throws ApiError
     */
    public static invitationControllerVerifyCode(
        requestBody: {
            invitationCode: string;
        },
    ): CancelablePromise<boolean> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/invitations/verify',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
