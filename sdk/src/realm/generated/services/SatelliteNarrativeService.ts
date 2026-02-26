/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateSatelliteDto } from '../models/CreateSatelliteDto';
import type { CreateSyntheticMemoryDto } from '../models/CreateSyntheticMemoryDto';
import type { SatelliteDetailDto } from '../models/SatelliteDetailDto';
import type { VerifySyntheticMemoryDto } from '../models/VerifySyntheticMemoryDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SatelliteNarrativeService {
    /**
     * Create a satellite (contextual memory fragment)
     * @param requestBody
     * @returns SatelliteDetailDto
     * @throws ApiError
     */
    public static satelliteControllerCreate(
        requestBody: CreateSatelliteDto,
    ): CancelablePromise<SatelliteDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/satellites',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * List satellites attached to a spine event
     * @param eventId Spine Event ID
     * @returns SatelliteDetailDto
     * @throws ApiError
     */
    public static satelliteControllerFindBySpineEvent(
        eventId: string,
    ): CancelablePromise<Array<SatelliteDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/satellites/by-event/{eventId}',
            path: {
                'eventId': eventId,
            },
        });
    }
    /**
     * List satellites in a scene
     * @param sceneId Scene ID
     * @param worldId World ID
     * @returns SatelliteDetailDto
     * @throws ApiError
     */
    public static satelliteControllerFindByScene(
        sceneId: string,
        worldId: string,
    ): CancelablePromise<Array<SatelliteDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/satellites/by-scene/{worldId}/{sceneId}',
            path: {
                'sceneId': sceneId,
                'worldId': worldId,
            },
        });
    }
    /**
     * List satellites for a spine
     * @param spineId Spine ID
     * @returns SatelliteDetailDto
     * @throws ApiError
     */
    public static satelliteControllerFindBySpine(
        spineId: string,
    ): CancelablePromise<Array<SatelliteDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/satellites/by-spine/{spineId}',
            path: {
                'spineId': spineId,
            },
        });
    }
    /**
     * Search satellites by content similarity
     * @param worldId World ID
     * @returns SatelliteDetailDto
     * @throws ApiError
     */
    public static satelliteControllerSearchSimilar(
        worldId: string,
    ): CancelablePromise<Array<SatelliteDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/satellites/search/{worldId}',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Create a synthetic memory (from time gap fill)
     * @param requestBody
     * @returns SatelliteDetailDto
     * @throws ApiError
     */
    public static satelliteControllerCreateSyntheticMemory(
        requestBody: CreateSyntheticMemoryDto,
    ): CancelablePromise<SatelliteDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/satellites/synthetic',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * List pending synthetic memories for an agent
     * @param agentId Agent ID
     * @returns SatelliteDetailDto
     * @throws ApiError
     */
    public static satelliteControllerGetPendingSyntheticMemories(
        agentId: string,
    ): CancelablePromise<Array<SatelliteDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/satellites/synthetic/pending/{agentId}',
            path: {
                'agentId': agentId,
            },
        });
    }
    /**
     * Verify (canonize or reject) a synthetic memory
     * @param satelliteId Satellite ID
     * @param requestBody
     * @returns SatelliteDetailDto
     * @throws ApiError
     */
    public static satelliteControllerVerifySyntheticMemory(
        satelliteId: string,
        requestBody: VerifySyntheticMemoryDto,
    ): CancelablePromise<SatelliteDetailDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/world/satellites/synthetic/{satelliteId}/verify',
            path: {
                'satelliteId': satelliteId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete a satellite
     * @param satelliteId Satellite ID
     * @returns void
     * @throws ApiError
     */
    public static satelliteControllerDelete(
        satelliteId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/world/satellites/{satelliteId}',
            path: {
                'satelliteId': satelliteId,
            },
        });
    }
    /**
     * Get a satellite by ID
     * @param satelliteId Satellite ID
     * @returns SatelliteDetailDto
     * @throws ApiError
     */
    public static satelliteControllerFindById(
        satelliteId: string,
    ): CancelablePromise<SatelliteDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/satellites/{satelliteId}',
            path: {
                'satelliteId': satelliteId,
            },
        });
    }
    /**
     * Record a reference to a satellite (extends TTL)
     * @param satelliteId Satellite ID
     * @returns SatelliteDetailDto
     * @throws ApiError
     */
    public static satelliteControllerTouchReference(
        satelliteId: string,
    ): CancelablePromise<SatelliteDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/satellites/{satelliteId}/touch',
            path: {
                'satelliteId': satelliteId,
            },
        });
    }
}
