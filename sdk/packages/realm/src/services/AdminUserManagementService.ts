/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminUserManagementService {
    /**
     * List users with filters (Admin)
     * @param limit
     * @param page
     * @param status
     * @param role
     * @param search
     * @returns any
     * @throws ApiError
     */
    public static adminUserControllerFindAll(
        limit?: number,
        page?: number,
        status?: 'ONBOARDING' | 'CHECK_INVITED' | 'ACTIVE' | 'SUSPENDED' | 'BANNED',
        role?: 'USER' | 'AGENT' | 'SERVICE_ACC' | 'SYSTEM_BOT' | 'ADMIN',
        search?: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/users',
            query: {
                'limit': limit,
                'page': page,
                'status': status,
                'role': role,
                'search': search,
            },
        });
    }
    /**
     * Get user 360 view (Admin)
     * @param id User ID
     * @returns any
     * @throws ApiError
     */
    public static adminUserControllerFindOne(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/users/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Clear violation profile info (Admin)
     * @param id User ID
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static adminUserControllerClearProfile(
        id: string,
        requestBody: {
            avatar?: boolean;
            bio?: boolean;
            displayName?: boolean;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/admin/users/{id}/profile',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Ban or Unban user
     * @param id User ID
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static adminUserControllerUpdateUserStatus(
        id: string,
        requestBody: {
            reason?: string;
            status?: 'ONBOARDING' | 'CHECK_INVITED' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/admin/users/{id}/status',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
