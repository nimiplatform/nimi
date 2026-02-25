/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreatePostDto } from '../models/CreatePostDto';
import type { FeedResponseDto } from '../models/FeedResponseDto';
import type { PostDto } from '../models/PostDto';
import type { UpdatePostDto } from '../models/UpdatePostDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PostService {
    /**
     * Get home feed
     * @param visibility
     * @param worldId
     * @param authorId
     * @param scope
     * @param limit
     * @param cursor
     * @returns FeedResponseDto
     * @throws ApiError
     */
    public static getHomeFeed(
        visibility?: 'PUBLIC' | 'FRIENDS' | 'PRIVATE',
        worldId?: string,
        authorId?: string,
        scope?: 'friends' | 'forYou' | 'all',
        limit?: number,
        cursor?: string,
    ): CancelablePromise<FeedResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/posts',
            query: {
                'visibility': visibility,
                'worldId': worldId,
                'authorId': authorId,
                'scope': scope,
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * Create post
     * @param requestBody
     * @returns PostDto
     * @throws ApiError
     */
    public static createPost(
        requestBody: CreatePostDto,
    ): CancelablePromise<PostDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/posts',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete post
     * @param id
     * @returns void
     * @throws ApiError
     */
    public static deletePost(
        id: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/world/posts/by-id/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get post by id
     * @param id
     * @param worldId
     * @returns PostDto
     * @throws ApiError
     */
    public static getPost(
        id: string,
        worldId?: string,
    ): CancelablePromise<PostDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/posts/by-id/{id}',
            path: {
                'id': id,
            },
            query: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Update post
     * @param id
     * @param requestBody
     * @returns PostDto
     * @throws ApiError
     */
    public static updatePost(
        id: string,
        requestBody: UpdatePostDto,
    ): CancelablePromise<PostDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/world/posts/by-id/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Unlike post
     * @param postId
     * @returns void
     * @throws ApiError
     */
    public static unlikePost(
        postId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/world/posts/by-id/{postId}/like',
            path: {
                'postId': postId,
            },
        });
    }
    /**
     * Like post
     * @param postId
     * @returns void
     * @throws ApiError
     */
    public static likePost(
        postId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/posts/by-id/{postId}/like',
            path: {
                'postId': postId,
            },
        });
    }
    /**
     * List liked posts
     * @param worldId
     * @param limit
     * @param cursor
     * @param userId
     * @returns FeedResponseDto
     * @throws ApiError
     */
    public static listLikedPosts(
        worldId?: string,
        limit?: number,
        cursor?: string,
        userId?: string,
    ): CancelablePromise<FeedResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/posts/liked',
            query: {
                'worldId': worldId,
                'limit': limit,
                'cursor': cursor,
                'userId': userId,
            },
        });
    }
}
