/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RelationshipResponseDto } from '../models/RelationshipResponseDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class RelationshipsMetaGraphService {
    /**
     * Create a relationship with another account
     * @returns RelationshipResponseDto
     * @throws ApiError
     */
    public static relationshipControllerCreateRelationship(): CancelablePromise<RelationshipResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/human/relationships',
        });
    }
    /**
     * Get my relationships
     * @param direction
     * @returns RelationshipResponseDto
     * @throws ApiError
     */
    public static relationshipControllerGetMyRelationships(
        direction?: 'outgoing' | 'incoming',
    ): CancelablePromise<Array<RelationshipResponseDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/relationships/me',
            query: {
                'direction': direction,
            },
        });
    }
    /**
     * Remove a relationship
     * @param id Relationship ID
     * @returns any
     * @throws ApiError
     */
    public static relationshipControllerDeleteRelationship(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/human/relationships/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Update relationship (strength/context)
     * @param id Relationship ID
     * @returns RelationshipResponseDto
     * @throws ApiError
     */
    public static relationshipControllerUpdateRelationship(
        id: string,
    ): CancelablePromise<RelationshipResponseDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/human/relationships/{id}',
            path: {
                'id': id,
            },
        });
    }
}
