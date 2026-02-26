/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorldDetailDto } from '../models/WorldDetailDto';
import type { WorldLevelAuditEventDto } from '../models/WorldLevelAuditEventDto';
import type { WorldviewDetailDto } from '../models/WorldviewDetailDto';
import type { WorldviewEventDto } from '../models/WorldviewEventDto';
import type { WorldviewSnapshotDto } from '../models/WorldviewSnapshotDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class WorldsService {
    /**
     * List worlds (defaults to ACTIVE)
     * @param status
     * @returns WorldDetailDto
     * @throws ApiError
     */
    public static worldControllerListWorlds(
        status?: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED',
    ): CancelablePromise<Array<WorldDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world',
            query: {
                'status': status,
            },
        });
    }
    /**
     * Create a sub-world (requires Pro/Max subscription)
     * @returns WorldDetailDto
     * @throws ApiError
     */
    public static worldControllerCreateWorld(): CancelablePromise<WorldDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world',
        });
    }
    /**
     * Get world by ID
     * @returns WorldDetailDto
     * @throws ApiError
     */
    public static worldControllerGetWorld(): CancelablePromise<WorldDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}',
        });
    }
    /**
     * List agents in a world
     * @returns any
     * @throws ApiError
     */
    public static worldControllerGetWorldAgents(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}/agents',
        });
    }
    /**
     * Get world level audit events (latest first)
     * @param limit
     * @returns WorldLevelAuditEventDto
     * @throws ApiError
     */
    public static worldControllerGetWorldLevelAudits(
        limit?: number,
    ): CancelablePromise<Array<WorldLevelAuditEventDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}/level/audits',
            query: {
                'limit': limit,
            },
        });
    }
    /**
     * Return to main world
     * @returns any
     * @throws ApiError
     */
    public static worldControllerReturnToMainWorld(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/by-id/{id}/return',
        });
    }
    /**
     * Transit into a sub-world (checks scene quota)
     * @returns any
     * @throws ApiError
     */
    public static worldControllerTransitToWorld(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/by-id/{id}/transit',
        });
    }
    /**
     * Get worldview for a world
     * @returns WorldviewDetailDto
     * @throws ApiError
     */
    public static worldControllerGetWorldview(): CancelablePromise<WorldviewDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}/worldview',
            errors: {
                404: `Worldview not found`,
            },
        });
    }
    /**
     * List worldview event history
     * @param offset
     * @param limit
     * @returns WorldviewEventDto
     * @throws ApiError
     */
    public static worldControllerGetWorldviewEvents(
        offset?: number,
        limit?: number,
    ): CancelablePromise<Array<WorldviewEventDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}/worldview/events',
            query: {
                'offset': offset,
                'limit': limit,
            },
        });
    }
    /**
     * Revert worldview to a snapshot version
     * @param version Target snapshot version
     * @returns WorldviewDetailDto
     * @throws ApiError
     */
    public static worldControllerRollbackWorldview(
        version: number,
    ): CancelablePromise<WorldviewDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/by-id/{id}/worldview/rollback',
            query: {
                'version': version,
            },
        });
    }
    /**
     * List worldview snapshots
     * @returns WorldviewSnapshotDto
     * @throws ApiError
     */
    public static worldControllerGetWorldviewSnapshots(): CancelablePromise<Array<WorldviewSnapshotDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}/worldview/snapshots',
        });
    }
    /**
     * Create a worldview snapshot
     * @returns WorldviewSnapshotDto
     * @throws ApiError
     */
    public static worldControllerCreateWorldviewSnapshot(): CancelablePromise<WorldviewSnapshotDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/by-id/{id}/worldview/snapshots',
        });
    }
    /**
     * Get current scene quota usage
     * @returns any
     * @throws ApiError
     */
    public static worldControllerGetSceneQuota(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/me/scene-quota',
        });
    }
    /**
     * Get OASIS (main world)
     * @returns WorldDetailDto
     * @throws ApiError
     */
    public static worldControllerGetMainWorld(): CancelablePromise<WorldDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/oasis',
        });
    }
}
