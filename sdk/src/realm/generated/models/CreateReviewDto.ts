/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReviewRating } from './ReviewRating';
export type CreateReviewDto = {
    comment?: string;
    /**
     * ID of the gift transaction to review
     */
    giftTransactionId: string;
    rating: ReviewRating;
    tags?: string;
};

