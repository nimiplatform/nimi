/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserProfileDto } from '../models/UserProfileDto';
import type { UserSearchResponseDto } from '../models/UserSearchResponseDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class UserService {
    /**
     * Get user by id
     * @param id
     * @returns UserProfileDto
     * @throws ApiError
     */
    public static getUser(
        id: string,
    ): CancelablePromise<UserProfileDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/accounts/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Remove friend
     * @param id
     * @returns void
     * @throws ApiError
     */
    public static removeFriend(
        id: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/human/accounts/{id}/friends',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get user friend list
     * Returns friend IDs for the target user (visibility-controlled).
     * @param id Target user ID
     * @returns string Friend IDs list
     * @throws ApiError
     */
    public static getUserFriends(
        id: string,
    ): CancelablePromise<Array<string>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/accounts/{id}/friends',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Add friend
     * @param id
     * @returns void
     * @throws ApiError
     */
    public static addFriend(
        id: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/human/accounts/{id}/friends',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get mutual friends
     * Returns paginated list of users who are friends with both the current user and the target user.
     * @param id Target user ID
     * @param cursor Pagination cursor (user ID)
     * @param limit Max items per page (default 20, max 100)
     * @returns any Mutual friends list
     * @throws ApiError
     */
    public static getMutualFriends(
        id: string,
        cursor?: string,
        limit?: number,
    ): CancelablePromise<{
        items?: Array<{
            /**
             * Avatar URL
             */
            avatarUrl?: string | null;
            /**
             * User bio
             */
            bio?: string | null;
            /**
             * Display name
             */
            displayName?: string | null;
            /**
             * User handle
             */
            handle?: string | null;
            /**
             * User ID
             */
            id?: string;
        }>;
        /**
         * Cursor for next page
         */
        nextCursor?: string | null;
        /**
         * Total number of mutual friends
         */
        total?: number;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/accounts/{id}/mutual-friends',
            path: {
                'id': id,
            },
            query: {
                'cursor': cursor,
                'limit': limit,
            },
        });
    }
    /**
     * Get mutual friends count
     * Returns the count of mutual friends between current user and target user.
     * @param id Target user ID
     * @returns any Mutual friends count
     * @throws ApiError
     */
    public static getMutualFriendsCount(
        id: string,
    ): CancelablePromise<{
        /**
         * Number of mutual friends
         */
        count?: number;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/accounts/{id}/mutual-friends/count',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Check handle availability
     * @param handle
     * @returns any
     * @throws ApiError
     */
    public static checkHandle(
        handle: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/check-handle',
            query: {
                'handle': handle,
            },
        });
    }
    /**
     * Get user by handle
     * @param handle
     * @returns UserProfileDto
     * @throws ApiError
     */
    public static getUserByHandle(
        handle: string,
    ): CancelablePromise<UserProfileDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/handle/{handle}',
            path: {
                'handle': handle,
            },
        });
    }
    /**
     * List online user ids
     * @returns any
     * @throws ApiError
     */
    public static listOnlineUsers(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/online',
        });
    }
    /**
     * Search users
     * Search users by keyword with pagination and filtering options.
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
     * @param q Search keyword
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
            url: '/api/human/search',
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
