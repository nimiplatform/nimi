/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AgentNsfwConsentService {
    /**
     * Update Agent NSFW consent (creator only)
     * @param id Agent account ID
     * @returns any Updated NSFW consent state
     * @throws ApiError
     */
    public static agentNsfwConsentControllerUpdateAgentConsent(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/agent/accounts/{id}/visibility/nsfw-consent',
            path: {
                'id': id,
            },
        });
    }
}
