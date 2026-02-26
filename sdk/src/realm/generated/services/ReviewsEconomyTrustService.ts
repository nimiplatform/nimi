/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateReviewDto } from '../models/CreateReviewDto';
import type { ReviewDto } from '../models/ReviewDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ReviewsEconomyTrustService {
    /**
     * Get reviews received by a user/agent
     * @param userId The ID of the user/agent being reviewed
     * @returns ReviewDto
     * @throws ApiError
     */
    public static reviewControllerGetReviews(
        userId: string,
    ): CancelablePromise<Array<ReviewDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/reviews',
            query: {
                'userId': userId,
            },
        });
    }
    /**
     * Create a review for a Gift Transaction
     * @param requestBody
     * @returns ReviewDto
     * @throws ApiError
     */
    public static reviewControllerCreateReview(
        requestBody: CreateReviewDto,
    ): CancelablePromise<ReviewDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/reviews',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
