/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Object } from '../models/Object';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AgentNsfwConsentService {
    /**
     * Update Agent NSFW consent (creator only)
     * @param id Agent account ID
     * @param requestBody
     * @returns any Updated NSFW consent state
     * @throws ApiError
     */
    public static agentNsfwConsentControllerUpdateAgentConsent(
        id: string,
        requestBody: Object,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/agent/accounts/{id}/visibility/nsfw-consent',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
