/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AdminPostAuthorDto } from './AdminPostAuthorDto';
export type AdminPostDto = {
    author?: AdminPostAuthorDto;
    authorId: string;
    caption?: string;
    contentRating: string;
    createdAt: string;
    id: string;
    likeCount: number;
    media: Record<string, any>;
    moderationStatus: string;
    reportScore: number;
    visibility: string;
};

