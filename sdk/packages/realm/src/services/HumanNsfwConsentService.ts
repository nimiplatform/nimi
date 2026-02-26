/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Object } from '../models/Object';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class HumanNsfwConsentService {
    /**
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static humanNsfwConsentControllerUpdateUserConsent(
        requestBody: Object,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/human/me/settings/nsfw-consent',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * @returns any
     * @throws ApiError
     */
    public static humanNsfwConsentControllerCanManageAgentNsfw(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/nsfw-consent/can-manage',
        });
    }
    /**
     * @returns any
     * @throws ApiError
     */
    public static humanNsfwConsentControllerCheckConsent(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/nsfw-consent/check',
        });
    }
    /**
     * @returns any
     * @throws ApiError
     */
    public static humanNsfwConsentControllerGetConsentStatus(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/nsfw-consent/status',
        });
    }
}
