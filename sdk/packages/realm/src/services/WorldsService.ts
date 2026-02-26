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
     * @param id World ID
     * @returns WorldDetailDto
     * @throws ApiError
     */
    public static worldControllerGetWorld(
        id: string,
    ): CancelablePromise<WorldDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * List agents in a world
     * @param id World ID
     * @returns any
     * @throws ApiError
     */
    public static worldControllerGetWorldAgents(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}/agents',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get world level audit events (latest first)
     * @param id World ID
     * @param limit
     * @returns WorldLevelAuditEventDto
     * @throws ApiError
     */
    public static worldControllerGetWorldLevelAudits(
        id: string,
        limit?: number,
    ): CancelablePromise<Array<WorldLevelAuditEventDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}/level/audits',
            path: {
                'id': id,
            },
            query: {
                'limit': limit,
            },
        });
    }
    /**
     * Return to main world
     * @param id World ID
     * @returns any
     * @throws ApiError
     */
    public static worldControllerReturnToMainWorld(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/by-id/{id}/return',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Transit into a sub-world (checks scene quota)
     * @param id World ID
     * @returns any
     * @throws ApiError
     */
    public static worldControllerTransitToWorld(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/by-id/{id}/transit',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get worldview for a world
     * @param id World ID
     * @returns WorldviewDetailDto
     * @throws ApiError
     */
    public static worldControllerGetWorldview(
        id: string,
    ): CancelablePromise<WorldviewDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}/worldview',
            path: {
                'id': id,
            },
            errors: {
                404: `Worldview not found`,
            },
        });
    }
    /**
     * List worldview event history
     * @param id World ID
     * @param offset
     * @param limit
     * @returns WorldviewEventDto
     * @throws ApiError
     */
    public static worldControllerGetWorldviewEvents(
        id: string,
        offset?: number,
        limit?: number,
    ): CancelablePromise<Array<WorldviewEventDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}/worldview/events',
            path: {
                'id': id,
            },
            query: {
                'offset': offset,
                'limit': limit,
            },
        });
    }
    /**
     * Revert worldview to a snapshot version
     * @param version Target snapshot version
     * @param id World ID
     * @returns WorldviewDetailDto
     * @throws ApiError
     */
    public static worldControllerRollbackWorldview(
        version: number,
        id: string,
    ): CancelablePromise<WorldviewDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/by-id/{id}/worldview/rollback',
            path: {
                'id': id,
            },
            query: {
                'version': version,
            },
        });
    }
    /**
     * List worldview snapshots
     * @param id World ID
     * @returns WorldviewSnapshotDto
     * @throws ApiError
     */
    public static worldControllerGetWorldviewSnapshots(
        id: string,
    ): CancelablePromise<Array<WorldviewSnapshotDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{id}/worldview/snapshots',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Create a worldview snapshot
     * @param id World ID
     * @returns WorldviewSnapshotDto
     * @throws ApiError
     */
    public static worldControllerCreateWorldviewSnapshot(
        id: string,
    ): CancelablePromise<WorldviewSnapshotDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/by-id/{id}/worldview/snapshots',
            path: {
                'id': id,
            },
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
