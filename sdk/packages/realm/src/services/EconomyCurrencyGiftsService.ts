/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AgentOriginDto } from '../models/AgentOriginDto';
import type { CanWithdrawDto } from '../models/CanWithdrawDto';
import type { ConnectDashboardLinkDto } from '../models/ConnectDashboardLinkDto';
import type { ConnectOnboardingResponseDto } from '../models/ConnectOnboardingResponseDto';
import type { CreateConnectOnboardingDto } from '../models/CreateConnectOnboardingDto';
import type { CreateDepositOrderDto } from '../models/CreateDepositOrderDto';
import type { CreatePortalSessionDto } from '../models/CreatePortalSessionDto';
import type { CreateSparkCheckoutDto } from '../models/CreateSparkCheckoutDto';
import type { CreateSubscriptionCheckoutDto } from '../models/CreateSubscriptionCheckoutDto';
import type { CreateWithdrawalDto } from '../models/CreateWithdrawalDto';
import type { CurrencyBalancesDto } from '../models/CurrencyBalancesDto';
import type { CurrencyTransactionHistoryDto } from '../models/CurrencyTransactionHistoryDto';
import type { DepositOrderDto } from '../models/DepositOrderDto';
import type { EnergyQuotaStatusDto } from '../models/EnergyQuotaStatusDto';
import type { GiftCatalogItemDto } from '../models/GiftCatalogItemDto';
import type { GiftTransactionDto } from '../models/GiftTransactionDto';
import type { PortalSessionDto } from '../models/PortalSessionDto';
import type { ReceivedGiftsResponseDto } from '../models/ReceivedGiftsResponseDto';
import type { RejectGiftDto } from '../models/RejectGiftDto';
import type { RevenueDistributionPreviewDto } from '../models/RevenueDistributionPreviewDto';
import type { RevenueShareConfigDto } from '../models/RevenueShareConfigDto';
import type { SendGiftDto } from '../models/SendGiftDto';
import type { SparkCheckoutSessionDto } from '../models/SparkCheckoutSessionDto';
import type { SparkPackageDto } from '../models/SparkPackageDto';
import type { StripeConnectStatusDto } from '../models/StripeConnectStatusDto';
import type { SubscriptionCheckoutSessionDto } from '../models/SubscriptionCheckoutSessionDto';
import type { SubscriptionDto } from '../models/SubscriptionDto';
import type { SubscriptionTierConfigDto } from '../models/SubscriptionTierConfigDto';
import type { WithdrawalConfigDto } from '../models/WithdrawalConfigDto';
import type { WithdrawalDto } from '../models/WithdrawalDto';
import type { WithdrawalHistoryDto } from '../models/WithdrawalHistoryDto';
import type { WithdrawalSummaryDto } from '../models/WithdrawalSummaryDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class EconomyCurrencyGiftsService {
    /**
     * Get user currency balances (Spark & Gem)
     * @returns CurrencyBalancesDto
     * @throws ApiError
     */
    public static economyControllerGetBalances(): CancelablePromise<CurrencyBalancesDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/balances',
        });
    }
    /**
     * Create Stripe Connect dashboard link
     * @returns ConnectDashboardLinkDto
     * @throws ApiError
     */
    public static economyControllerCreateConnectDashboard(): CancelablePromise<ConnectDashboardLinkDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/connect/dashboard',
        });
    }
    /**
     * Create Stripe Connect onboarding link
     * @param requestBody
     * @returns ConnectOnboardingResponseDto
     * @throws ApiError
     */
    public static economyControllerCreateConnectOnboarding(
        requestBody: CreateConnectOnboardingDto,
    ): CancelablePromise<ConnectOnboardingResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/connect/onboarding',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get Stripe Connect account status
     * @returns StripeConnectStatusDto
     * @throws ApiError
     */
    public static economyControllerGetConnectStatus(): CancelablePromise<StripeConnectStatusDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/connect/status',
        });
    }
    /**
     * Create a deposit order (Fiat/Crypto)
     * @param requestBody
     * @returns DepositOrderDto
     * @throws ApiError
     */
    public static economyControllerCreateDeposit(
        requestBody: CreateDepositOrderDto,
    ): CancelablePromise<DepositOrderDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/deposit',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get Gem transaction history
     * @param limit
     * @param cursor
     * @returns CurrencyTransactionHistoryDto
     * @throws ApiError
     */
    public static economyControllerGetGemHistory(
        limit?: number,
        cursor?: string,
    ): CancelablePromise<CurrencyTransactionHistoryDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/gem/history',
            query: {
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * Get available gifts
     * @returns GiftCatalogItemDto
     * @throws ApiError
     */
    public static economyControllerGetGiftCatalog(): CancelablePromise<Array<GiftCatalogItemDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/gifts/catalog',
        });
    }
    /**
     * Get received gifts
     * @param limit
     * @param cursor
     * @returns ReceivedGiftsResponseDto
     * @throws ApiError
     */
    public static economyControllerGetReceivedGifts(
        limit?: number,
        cursor?: string,
    ): CancelablePromise<ReceivedGiftsResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/gifts/received',
            query: {
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * Send a gift to another user
     * @param requestBody
     * @returns GiftTransactionDto
     * @throws ApiError
     */
    public static economyControllerSendGift(
        requestBody: SendGiftDto,
    ): CancelablePromise<GiftTransactionDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/gifts/send',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get sent gifts
     * @param limit
     * @param cursor
     * @returns ReceivedGiftsResponseDto
     * @throws ApiError
     */
    public static economyControllerGetSentGifts(
        limit?: number,
        cursor?: string,
    ): CancelablePromise<ReceivedGiftsResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/gifts/sent',
            query: {
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * Reject/Return a gift
     * @param giftId
     * @param requestBody
     * @returns GiftTransactionDto
     * @throws ApiError
     */
    public static economyControllerRejectGift(
        giftId: string,
        requestBody: RejectGiftDto,
    ): CancelablePromise<GiftTransactionDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/gifts/{giftId}/reject',
            path: {
                'giftId': giftId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Claim a pending gift
     * @param id Gift Transaction ID
     * @returns GiftTransactionDto
     * @throws ApiError
     */
    public static economyControllerClaimGift(
        id: string,
    ): CancelablePromise<GiftTransactionDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/gifts/{id}/claim',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get user energy quota status
     * @returns EnergyQuotaStatusDto
     * @throws ApiError
     */
    public static economyControllerGetQuotaStatus(): CancelablePromise<EnergyQuotaStatusDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/quota',
        });
    }
    /**
     * Get Agent origin classification for revenue sharing
     * @param agentId Agent ID
     * @returns AgentOriginDto
     * @throws ApiError
     */
    public static economyControllerGetAgentOrigin(
        agentId: string,
    ): CancelablePromise<AgentOriginDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/revenue-share/agent-origin/{agentId}',
            path: {
                'agentId': agentId,
            },
        });
    }
    /**
     * Get revenue share configuration
     * @returns RevenueShareConfigDto
     * @throws ApiError
     */
    public static economyControllerGetRevenueShareConfig(): CancelablePromise<RevenueShareConfigDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/revenue-share/config',
        });
    }
    /**
     * Preview revenue distribution for an Agent
     * @param amount Total revenue amount (as string)
     * @param agentId Agent ID
     * @returns RevenueDistributionPreviewDto
     * @throws ApiError
     */
    public static economyControllerPreviewRevenueDistribution(
        amount: string,
        agentId: string,
    ): CancelablePromise<RevenueDistributionPreviewDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/revenue-share/preview',
            query: {
                'amount': amount,
                'agentId': agentId,
            },
        });
    }
    /**
     * Create Stripe checkout session for Spark purchase
     * @param requestBody
     * @returns SparkCheckoutSessionDto
     * @throws ApiError
     */
    public static economyControllerCreateSparkCheckout(
        requestBody: CreateSparkCheckoutDto,
    ): CancelablePromise<SparkCheckoutSessionDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/spark/checkout',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get Spark transaction history
     * @param limit
     * @param cursor
     * @returns CurrencyTransactionHistoryDto
     * @throws ApiError
     */
    public static economyControllerGetSparkHistory(
        limit?: number,
        cursor?: string,
    ): CancelablePromise<CurrencyTransactionHistoryDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/spark/history',
            query: {
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * Get available Spark purchase packages
     * @returns SparkPackageDto
     * @throws ApiError
     */
    public static economyControllerGetSparkPackages(): CancelablePromise<Array<SparkPackageDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/spark/packages',
        });
    }
    /**
     * Get user subscription status
     * @returns SubscriptionDto
     * @throws ApiError
     */
    public static economyControllerGetSubscription(): CancelablePromise<SubscriptionDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/subscription',
        });
    }
    /**
     * Cancel subscription at period end
     * @returns any
     * @throws ApiError
     */
    public static economyControllerCancelSubscription(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/subscription/cancel',
        });
    }
    /**
     * Create Stripe checkout session for subscription
     * @param requestBody
     * @returns SubscriptionCheckoutSessionDto
     * @throws ApiError
     */
    public static economyControllerCreateSubscriptionCheckout(
        requestBody: CreateSubscriptionCheckoutDto,
    ): CancelablePromise<SubscriptionCheckoutSessionDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/subscription/checkout',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Create Stripe billing portal session
     * @param requestBody
     * @returns PortalSessionDto
     * @throws ApiError
     */
    public static economyControllerCreatePortalSession(
        requestBody: CreatePortalSessionDto,
    ): CancelablePromise<PortalSessionDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/subscription/portal',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get all available subscription tiers
     * @returns SubscriptionTierConfigDto
     * @throws ApiError
     */
    public static economyControllerGetSubscriptionTiers(): CancelablePromise<Array<SubscriptionTierConfigDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/subscription/tiers',
        });
    }
    /**
     * Get withdrawal details
     * @param id
     * @returns WithdrawalDto
     * @throws ApiError
     */
    public static economyControllerGetWithdrawal(
        id: string,
    ): CancelablePromise<WithdrawalDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/withdrawals/by-id/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Calculate withdrawal summary for an amount
     * @param amount Gem amount to withdraw
     * @returns WithdrawalSummaryDto
     * @throws ApiError
     */
    public static economyControllerCalculateWithdrawal(
        amount: string,
    ): CancelablePromise<WithdrawalSummaryDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/withdrawals/calculate',
            query: {
                'amount': amount,
            },
        });
    }
    /**
     * Check if user can withdraw
     * @returns CanWithdrawDto
     * @throws ApiError
     */
    public static economyControllerCanWithdraw(): CancelablePromise<CanWithdrawDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/withdrawals/can-withdraw',
        });
    }
    /**
     * Get withdrawal configuration (min amount, fees)
     * @returns WithdrawalConfigDto
     * @throws ApiError
     */
    public static economyControllerGetWithdrawalConfig(): CancelablePromise<WithdrawalConfigDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/withdrawals/config',
        });
    }
    /**
     * Create a withdrawal request
     * @param requestBody
     * @returns WithdrawalDto
     * @throws ApiError
     */
    public static economyControllerCreateWithdrawal(
        requestBody: CreateWithdrawalDto,
    ): CancelablePromise<WithdrawalDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/economy/withdrawals/create',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get withdrawal history
     * @param limit
     * @param cursor
     * @returns WithdrawalHistoryDto
     * @throws ApiError
     */
    public static economyControllerGetWithdrawalHistory(
        limit?: number,
        cursor?: string,
    ): CancelablePromise<WithdrawalHistoryDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/economy/withdrawals/history',
            query: {
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
}
