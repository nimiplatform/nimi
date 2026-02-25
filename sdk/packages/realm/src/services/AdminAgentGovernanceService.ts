/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminAgentGovernanceService {
    /**
     * List agents with filters (Admin)
     * @param limit
     * @param page
     * @param creatorId
     * @param status
     * @param tier
     * @param search
     * @returns any
     * @throws ApiError
     */
    public static adminAgentControllerFindAll(
        limit?: number,
        page?: number,
        creatorId?: any,
        status?: 'ONBOARDING' | 'CHECK_INVITED' | 'ACTIVE' | 'SUSPENDED' | 'BANNED',
        tier?: 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL',
        search?: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/agents',
            query: {
                'limit': limit,
                'page': page,
                'creatorId': creatorId,
                'status': status,
                'tier': tier,
                'search': search,
            },
        });
    }
    /**
     * Get agent details (Admin)
     * @param id Agent ID
     * @returns any
     * @throws ApiError
     */
    public static adminAgentControllerFindOne(
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/agents/accounts/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get Experience Consensus (Spec 5.2)
     * Calculates user influence consensus on an agent with anti-manipulation mechanisms: reputation weighting, depth weighting, marginal diminishing, and sparsity penalty.
     * @param id Agent ID
     * @param days Time window in days (default: 30)
     * @returns any
     * @throws ApiError
     */
    public static adminAgentControllerGetExperienceConsensus(
        id: any,
        days?: number,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/agents/accounts/{id}/experience-consensus',
            path: {
                'id': id,
            },
            query: {
                'days': days,
            },
        });
    }
    /**
     * Kill Switch: Revoke all agent sessions
     * @param id Agent ID
     * @returns any
     * @throws ApiError
     */
    public static adminAgentControllerRevokeSessions(
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/admin/agents/accounts/{id}/revoke-sessions',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Suspend or Unsuspend Agent
     * @param id Agent ID
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static adminAgentControllerUpdateStatus(
        id: any,
        requestBody: {
            reason?: string;
            status?: 'ONBOARDING' | 'CHECK_INVITED' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/admin/agents/accounts/{id}/status',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Update Agent Verification Tier
     * @param id Agent ID
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static adminAgentControllerUpdateTier(
        id: any,
        requestBody: {
            tier?: 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL';
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/admin/agents/accounts/{id}/tier',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
