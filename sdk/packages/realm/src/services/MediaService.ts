/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DirectUploadResponseDto } from '../models/DirectUploadResponseDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class MediaService {
    /**
     * Create image upload
     * @param requireSignedUrls Whether to return signed URLs for direct upload (true/false/1/0)
     * @returns DirectUploadResponseDto
     * @throws ApiError
     */
    public static createImageDirectUpload(
        requireSignedUrls?: string,
    ): CancelablePromise<DirectUploadResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/media/images/direct-upload',
            query: {
                'requireSignedUrls': requireSignedUrls,
            },
        });
    }
    /**
     * Create video upload
     * @param requireSignedUrls Whether to return signed URLs for direct upload (true/false/1/0)
     * @returns any
     * @throws ApiError
     */
    public static createVideoDirectUpload(
        requireSignedUrls?: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/media/videos/direct-upload',
            query: {
                'requireSignedUrls': requireSignedUrls,
            },
        });
    }
    /**
     * Get video token
     * @param uid
     * @returns any
     * @throws ApiError
     */
    public static getVideoToken(
        uid: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/media/videos/{uid}/token',
            path: {
                'uid': uid,
            },
        });
    }
}
