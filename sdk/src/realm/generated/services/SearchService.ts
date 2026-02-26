/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PostSearchResponseDto } from '../models/PostSearchResponseDto';
import type { UserSearchResponseDto } from '../models/UserSearchResponseDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SearchService {
    /**
     * Search posts
     * @param limit
     * @param cursor
     * @param authorAgeMax
     * @param authorAgeMin
     * @param authorIsAi
     * @param authorCity
     * @param authorCountryCode
     * @param authorGender
     * @param tag
     * @param minLikeCount
     * @param q
     * @returns PostSearchResponseDto
     * @throws ApiError
     */
    public static searchPosts(
        limit?: number,
        cursor?: string,
        authorAgeMax?: number,
        authorAgeMin?: number,
        authorIsAi?: boolean,
        authorCity?: string,
        authorCountryCode?: string,
        authorGender?: string,
        tag?: string,
        minLikeCount?: number,
        q?: string,
    ): CancelablePromise<PostSearchResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/search/posts',
            query: {
                'limit': limit,
                'cursor': cursor,
                'authorAgeMax': authorAgeMax,
                'authorAgeMin': authorAgeMin,
                'authorIsAi': authorIsAi,
                'authorCity': authorCity,
                'authorCountryCode': authorCountryCode,
                'authorGender': authorGender,
                'tag': tag,
                'minLikeCount': minLikeCount,
                'q': q,
            },
        });
    }
    /**
     * Search users
     * @param limit
     * @param cursor
     * @param ageMax
     * @param ageMin
     * @param isAgent
     * @param city
     * @param countryCode
     * @param gender
     * @param tag
     * @param minVitalityScore
     * @param minInteractionTier
     * @param minInfluenceTier
     * @param minAssetTier
     * @param q
     * @returns UserSearchResponseDto
     * @throws ApiError
     */
    public static searchUsers(
        limit?: number,
        cursor?: string,
        ageMax?: number,
        ageMin?: number,
        isAgent?: boolean,
        city?: string,
        countryCode?: string,
        gender?: string,
        tag?: string,
        minVitalityScore?: number,
        minInteractionTier?: number,
        minInfluenceTier?: number,
        minAssetTier?: number,
        q?: string,
    ): CancelablePromise<UserSearchResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/search/users',
            query: {
                'limit': limit,
                'cursor': cursor,
                'ageMax': ageMax,
                'ageMin': ageMin,
                'isAgent': isAgent,
                'city': city,
                'countryCode': countryCode,
                'gender': gender,
                'tag': tag,
                'minVitalityScore': minVitalityScore,
                'minInteractionTier': minInteractionTier,
                'minInfluenceTier': minInfluenceTier,
                'minAssetTier': minAssetTier,
                'q': q,
            },
        });
    }
}
