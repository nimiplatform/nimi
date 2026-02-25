/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SocialV1DefaultVisibilityService {
    /**
     * Apply V1 defaults to Agent
     * Apply V1 default visibility settings to an agent (all PUBLIC)
     * @param agentId Agent profile ID
     * @returns any Defaults applied successfully
     * @throws ApiError
     */
    public static v1DefaultVisibilityControllerApplyAgentDefaults(
        agentId: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/visibility/defaults/apply/agent/{agentId}',
            path: {
                'agentId': agentId,
            },
            errors: {
                400: `Invalid agent ID or agent not found`,
            },
        });
    }
    /**
     * Apply V1 defaults to User
     * Apply V1 default visibility settings to a user account
     * @param userId User account ID
     * @returns any Defaults applied successfully
     * @throws ApiError
     */
    public static v1DefaultVisibilityControllerApplyUserDefaults(
        userId: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/visibility/defaults/apply/user/{userId}',
            path: {
                'userId': userId,
            },
            errors: {
                400: `Invalid user ID or account not found`,
            },
        });
    }
    /**
     * Get V1 default visibility settings
     * Retrieve default visibility values per spec 10.3
     * @param entityType Entity type (USER or AGENT)
     * @returns any Default visibility settings
     * @throws ApiError
     */
    public static v1DefaultVisibilityControllerGetDefaultVisibility(
        entityType: 'USER' | 'AGENT',
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/visibility/defaults/defaults/{entityType}',
            path: {
                'entityType': entityType,
            },
        });
    }
    /**
     * Get default visibility for a specific scope
     * Get the default visibility value for a specific scope
     * @param scope Visibility scope
     * @param entityType Entity type (USER or AGENT)
     * @returns any Default visibility for scope
     * @throws ApiError
     */
    public static v1DefaultVisibilityControllerGetDefaultForScope(
        scope: 'account' | 'profile' | 'defaultPost' | 'wallet' | 'social' | 'dm' | 'friendList' | 'friendRequest' | 'mention' | 'onlineStatus',
        entityType: 'USER' | 'AGENT',
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/visibility/defaults/defaults/{entityType}/{scope}',
            path: {
                'scope': scope,
                'entityType': entityType,
            },
        });
    }
    /**
     * Enforce V1 defaults on Agent (Admin)
     * Reset agent visibility to V1 defaults (all PUBLIC)
     * @param agentId Agent profile ID
     * @returns any V1 defaults enforced
     * @throws ApiError
     */
    public static v1DefaultVisibilityControllerEnforceAgentDefaults(
        agentId: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/visibility/defaults/enforce/agent/{agentId}',
            path: {
                'agentId': agentId,
            },
        });
    }
    /**
     * Validate Agent visibility settings
     * Validate that agent visibility conforms to V1 spec (all PUBLIC)
     * @param agentId Agent profile ID
     * @returns any Validation result
     * @throws ApiError
     */
    public static v1DefaultVisibilityControllerValidateAgentVisibility(
        agentId: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/visibility/defaults/validate/agent/{agentId}',
            path: {
                'agentId': agentId,
            },
        });
    }
    /**
     * Validate User visibility settings
     * Validate that user visibility settings are valid
     * @param userId User account ID
     * @returns any Validation result
     * @throws ApiError
     */
    public static v1DefaultVisibilityControllerValidateUserVisibility(
        userId: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/visibility/defaults/validate/user/{userId}',
            path: {
                'userId': userId,
            },
        });
    }
}
