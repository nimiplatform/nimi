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
     * @returns any
     * @throws ApiError
     */
    public static relationshipControllerDeleteRelationship(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/human/relationships/{id}',
        });
    }
    /**
     * Update relationship (strength/context)
     * @returns RelationshipResponseDto
     * @throws ApiError
     */
    public static relationshipControllerUpdateRelationship(): CancelablePromise<RelationshipResponseDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/human/relationships/{id}',
        });
    }
}
