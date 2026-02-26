/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SocialFourDimensionalAttributesService {
    /**
     * Get four-dimensional attributes
     * Get the four-dimensional attributes for a specific account (User or Agent)
     * @param accountId Account ID
     * @returns any Four-dimensional attributes retrieved successfully
     * @throws ApiError
     */
    public static fourDimensionAttributeControllerGetAttributes(
        accountId: string,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/four-dimension/attributes/{accountId}',
            path: {
                'accountId': accountId,
            },
            errors: {
                404: `Account not found`,
            },
        });
    }
    /**
     * Compare attributes between two accounts
     * Compare four-dimensional attributes between two accounts and get differences
     * @returns any Comparison result
     * @throws ApiError
     */
    public static fourDimensionAttributeControllerCompareAttributes(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/four-dimension/compare',
            errors: {
                404: `One or both accounts not found`,
            },
        });
    }
    /**
     * Get own four-dimensional attributes
     * Get the four-dimensional attributes for the current authenticated account
     * @returns any Four-dimensional attributes retrieved successfully
     * @throws ApiError
     */
    public static fourDimensionAttributeControllerGetOwnAttributes(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/four-dimension/me',
        });
    }
    /**
     * Query accounts by tier requirements
     * Find accounts that meet minimum tier requirements for discovery/matching
     * @returns any Matching accounts
     * @throws ApiError
     */
    public static fourDimensionAttributeControllerQueryByTier(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/four-dimension/query-by-tier',
        });
    }
}
