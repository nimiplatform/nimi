/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ExploreService {
    /**
     * Get explore feed
     * Returns the explore feed for the current user.
     * @param seed
     * @param tag
     * @param limit
     * @param cursor
     * @returns any
     * @throws ApiError
     */
    public static getExploreFeed(
        seed?: string,
        tag?: string,
        limit?: number,
        cursor?: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/explore',
            query: {
                'seed': seed,
                'tag': tag,
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * @returns any
     * @throws ApiError
     */
    public static exploreControllerCheckStatus(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/explore/status',
        });
    }
}
