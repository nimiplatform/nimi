/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TierDetailDto } from '../models/TierDetailDto';
import type { UpdateUserDto } from '../models/UpdateUserDto';
import type { UpdateUserNotificationSettingsDto } from '../models/UpdateUserNotificationSettingsDto';
import type { UpdateUserSettingsDto } from '../models/UpdateUserSettingsDto';
import type { UserCapabilitiesDto } from '../models/UserCapabilitiesDto';
import type { UserNotificationSettingsDto } from '../models/UserNotificationSettingsDto';
import type { UserPrivateDto } from '../models/UserPrivateDto';
import type { UserSettingsDto } from '../models/UserSettingsDto';
import type { UserWalletDto } from '../models/UserWalletDto';
import type { UserWalletListResponseDto } from '../models/UserWalletListResponseDto';
import type { WalletBindDto } from '../models/WalletBindDto';
import type { WalletPrepareBindDto } from '../models/WalletPrepareBindDto';
import type { WalletPrepareBindResponseDto } from '../models/WalletPrepareBindResponseDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class MeService {
    /**
     * Get current user profile
     * @returns UserPrivateDto
     * @throws ApiError
     */
    public static getMe(): CancelablePromise<UserPrivateDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me',
        });
    }
    /**
     * Update current user profile
     * @param requestBody
     * @returns UserPrivateDto The updated user profile
     * @throws ApiError
     */
    public static updateMe(
        requestBody: UpdateUserDto,
    ): CancelablePromise<UserPrivateDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/human/me',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get my blocked users list
     * Returns paginated list of users blocked by the current user, including their profile information and block metadata.
     * @param cursor Pagination cursor (ISO date string)
     * @param limit Max items per page (default 20, max 100)
     * @returns any Blocked users list with details
     * @throws ApiError
     */
    public static getMyBlockedUsers(
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
             * When the block was created
             */
            blockedAt?: string;
            /**
             * Display name
             */
            displayName?: string | null;
            /**
             * User handle
             */
            handle?: string | null;
            /**
             * Blocked user ID
             */
            id?: string;
            /**
             * Optional reason for blocking
             */
            reason?: string | null;
        }>;
        /**
         * Cursor for next page
         */
        nextCursor?: string | null;
        /**
         * Total number of blocked users
         */
        total?: number;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me/blocks',
            query: {
                'cursor': cursor,
                'limit': limit,
            },
        });
    }
    /**
     * Unblock a user
     * Unblocks the specified user. Returns 204 on success or if not blocked.
     * @param id User ID to unblock
     * @returns void
     * @throws ApiError
     */
    public static unblockUser(
        id: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/human/me/blocks/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Block a user
     * Blocks the specified user. Returns 204 on success or if already blocked.
     * @param id User ID to block
     * @returns void
     * @throws ApiError
     */
    public static blockUser(
        id: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/human/me/blocks/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get user capabilities
     * Returns aggregated user capabilities including agent creation limits, energy balance, quota status, and feature access.
     * @returns UserCapabilitiesDto User capabilities
     * @throws ApiError
     */
    public static getMyCapabilities(): CancelablePromise<UserCapabilitiesDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me/capabilities',
        });
    }
    /**
     * Get creator eligibility
     * Returns creator eligibility status based on subscription tier. Requires Pro or Max subscription.
     * @returns any Creator eligibility information
     * @throws ApiError
     */
    public static getMyCreatorEligibility(): CancelablePromise<{
        /**
         * Can create agents as creator
         */
        canCreateAgent?: boolean;
        /**
         * Can create worlds
         */
        canCreateWorld?: boolean;
        /**
         * Whether user can access creator features
         */
        isEligible?: boolean;
        /**
         * Human-readable eligibility message
         */
        message?: string;
        /**
         * Subscription status
         */
        status?: 'ACTIVE' | 'CANCELED' | 'PAST_DUE' | 'PAUSED';
        /**
         * Current subscription tier
         */
        tier?: 'FREE' | 'PRO' | 'MAX';
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me/creator-eligibility',
        });
    }
    /**
     * List my friend IDs
     * @returns any
     * @throws ApiError
     */
    public static listMyFriendIds(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me/friends',
        });
    }
    /**
     * List my friends with details
     * Returns paginated list of friends with their profile information including handle, display name, avatar, and friendship date.
     * @param cursor Pagination cursor (ISO date string)
     * @param limit Max items per page (default 20, max 100)
     * @returns any Friends list with details
     * @throws ApiError
     */
    public static listMyFriendsWithDetails(
        cursor?: string,
        limit?: number,
    ): CancelablePromise<{
        items?: Array<{
            avatarUrl?: string | null;
            bio?: string | null;
            displayName?: string | null;
            friendsSince?: string;
            handle?: string | null;
            id?: string;
            isAgent?: boolean;
        }>;
        nextCursor?: string | null;
        total?: number;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me/friends/list',
            query: {
                'cursor': cursor,
                'limit': limit,
            },
        });
    }
    /**
     * Get pending friend requests
     * Returns both received (from others) and sent (to others) pending friend requests.
     * @returns any Pending friend requests
     * @throws ApiError
     */
    public static getMyPendingFriendRequests(): CancelablePromise<{
        /**
         * Friend requests received from other users
         */
        received?: Array<{
            requestedAt?: string;
            /**
             * ID of the user who sent the request
             */
            userId?: string;
        }>;
        /**
         * Friend requests sent to other users
         */
        sent?: Array<{
            requestedAt?: string;
            /**
             * ID of the user to whom the request was sent
             */
            userId?: string;
        }>;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me/friends/pending',
        });
    }
    /**
     * Update user handle
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static updateMyHandle(
        requestBody: {
            handle?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/human/me/handle',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get user notification settings
     * Returns the current notification settings with defaults applied
     * @returns UserNotificationSettingsDto User notification settings
     * @throws ApiError
     */
    public static getMyNotificationSettings(): CancelablePromise<UserNotificationSettingsDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me/notification-settings',
        });
    }
    /**
     * Update user notification settings
     * Updates notification settings with partial merge (only provided fields are updated)
     * @param requestBody
     * @returns UserNotificationSettingsDto Updated notification settings
     * @throws ApiError
     */
    public static updateMyNotificationSettings(
        requestBody: UpdateUserNotificationSettingsDto,
    ): CancelablePromise<UserNotificationSettingsDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/human/me/notification-settings',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get PP slot configuration
     * @returns any
     * @throws ApiError
     */
    public static getMyPpConfig(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me/pp-config',
        });
    }
    /**
     * Update PP slot configuration
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static updateMyPpConfig(
        requestBody: {
            /**
             * PP slot configuration with slot1-slot4 component assignments
             */
            ppSlotConfig?: Record<string, any>;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/human/me/pp-config',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get current user settings
     * @returns UserSettingsDto User settings
     * @throws ApiError
     */
    public static getMySettings(): CancelablePromise<UserSettingsDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me/settings',
        });
    }
    /**
     * Update user settings
     * @param requestBody
     * @returns UserSettingsDto Updated user settings
     * @throws ApiError
     */
    public static updateMySettings(
        requestBody: UpdateUserSettingsDto,
    ): CancelablePromise<UserSettingsDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/human/me/settings',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get my tier details
     * @returns TierDetailDto
     * @throws ApiError
     */
    public static getMyTiers(): CancelablePromise<TierDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me/tiers',
        });
    }
    /**
     * List my wallets
     * @returns UserWalletListResponseDto
     * @throws ApiError
     */
    public static getMyWallets(): CancelablePromise<UserWalletListResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/me/wallets',
        });
    }
    /**
     * Bind wallet
     * @param requestBody
     * @returns UserWalletDto
     * @throws ApiError
     */
    public static bindWallet(
        requestBody: WalletBindDto,
    ): CancelablePromise<UserWalletDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/human/me/wallets',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Prepare wallet bind
     * @param requestBody
     * @returns WalletPrepareBindResponseDto
     * @throws ApiError
     */
    public static prepareBindWallet(
        requestBody: WalletPrepareBindDto,
    ): CancelablePromise<WalletPrepareBindResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/human/me/wallets/prepare-bind',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Unbind wallet
     * @param walletId
     * @returns void
     * @throws ApiError
     */
    public static unbindWallet(
        walletId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/human/me/wallets/{walletId}',
            path: {
                'walletId': walletId,
            },
        });
    }
}
