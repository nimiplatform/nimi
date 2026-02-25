/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EligibilityDto } from '../models/EligibilityDto';
import type { InviteCodeDto } from '../models/InviteCodeDto';
import type { InviterInfoDto } from '../models/InviterInfoDto';
import type { RedeemCodeDto } from '../models/RedeemCodeDto';
import type { ReferralStatsDto } from '../models/ReferralStatsDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ReferralService {
    /**
     * List my invitation codes
     * @returns InviteCodeDto
     * @throws ApiError
     */
    public static referralControllerListMyCodes(): CancelablePromise<Array<InviteCodeDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/referral/codes',
        });
    }
    /**
     * Generate a new invitation code (requires tier >= 3)
     * @returns InviteCodeDto
     * @throws ApiError
     */
    public static referralControllerGenerateCode(): CancelablePromise<InviteCodeDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/referral/codes',
        });
    }
    /**
     * Check if user can create invite codes (requires tier >= 3)
     * @returns EligibilityDto
     * @throws ApiError
     */
    public static referralControllerCheckEligibility(): CancelablePromise<EligibilityDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/referral/eligibility',
        });
    }
    /**
     * Get info about who invited me
     * @returns InviterInfoDto
     * @throws ApiError
     */
    public static referralControllerGetInviter(): CancelablePromise<InviterInfoDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/referral/inviter',
        });
    }
    /**
     * Redeem an invitation code
     * @param requestBody
     * @returns any Code redeemed successfully
     * @throws ApiError
     */
    public static referralControllerRedeemCode(
        requestBody: RedeemCodeDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/referral/redeem',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get my referral statistics (only visible to myself)
     * @returns ReferralStatsDto
     * @throws ApiError
     */
    public static referralControllerGetStats(): CancelablePromise<ReferralStatsDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/referral/stats',
        });
    }
}
