/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SendGiftDto = {
    /**
     * ID of the gift from catalog
     */
    giftId: string;
    message?: string;
    /**
     * ID of the user receiving the gift
     */
    receiverId: string;
    /**
     * Post ID context
     */
    relatedPostId?: string;
};

