package grpcserver

import (
	"context"
	"errors"
	"fmt"
	"strings"

	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
)

const sourceMaterializationAccessPolicyDigestV4 = "34f338ae76cbd85de58054cd6fc4d0ee18500030a0bc12f091e88d46f2fc572f"

type accountRealmSourceMaterializationIssuer struct {
	account        *accountservice.Service
	expectedIssuer string
}

func newAccountRealmSourceMaterializationIssuer(account *accountservice.Service, expectedIssuer string) (runtimeagentservice.RealmSourceMaterializationIssuer, error) {
	if account == nil {
		return nil, fmt.Errorf("source materialization account authority is required")
	}
	if expectedIssuer == "" || expectedIssuer != strings.TrimSpace(expectedIssuer) {
		return nil, fmt.Errorf("source materialization Realm issuer is invalid")
	}
	return &accountRealmSourceMaterializationIssuer{account: account, expectedIssuer: expectedIssuer}, nil
}

func (issuer *accountRealmSourceMaterializationIssuer) AcquireRealmSourceMaterialization(ctx context.Context, request runtimeagentservice.RealmSourceMaterializationIssuanceRequest) (runtimeagentservice.RealmSourceMaterializationAcquisition, error) {
	accountRequest := accountservice.RealmSourceMaterializationIssuanceRequest{
		AuthenticatedAccountID: request.AuthenticatedAccountID,
		SourceRef: accountservice.RealmSourceMaterializationSourceRefV3{
			Kind: request.SourceRef.Kind, ID: request.SourceRef.ID, WorldID: request.SourceRef.WorldID,
			OwnerAccountID: request.SourceRef.OwnerAccountID, SourceHash: request.SourceRef.SourceHash,
		},
		Challenge: accountservice.RealmSourceMaterializationChallengeV3{
			ChallengeID: request.Challenge.ChallengeID, ChallengeDigest: request.Challenge.ChallengeDigest,
			IntendedRuntimeAudience: request.Challenge.IntendedRuntimeAudience, ExpiresAt: request.Challenge.ExpiresAt,
		},
		Limits: accountservice.RealmSourceMaterializationLimitsV3{
			MaxSegmentBytes: request.Limits.MaxSegmentBytes, MaxSegmentComponentCount: request.Limits.MaxSegmentComponentCount,
			MaxChunkBytes: request.Limits.MaxChunkBytes, MaxSegmentChunks: request.Limits.MaxSegmentChunks,
			MaxSetSegments: request.Limits.MaxSetSegments, MaxSetBytes: request.Limits.MaxSetBytes,
			MaxSetComponentCount: request.Limits.MaxSetComponentCount, MaxSetChunks: request.Limits.MaxSetChunks,
		},
	}
	if request.SourceRef.WorldEntityRef != nil {
		accountRequest.SourceRef.WorldEntityRef = &accountservice.RealmSourceMaterializationWorldEntityRefV3{
			WorldID: request.SourceRef.WorldEntityRef.WorldID, EntityID: request.SourceRef.WorldEntityRef.EntityID,
		}
	}
	acquisition, err := issuer.account.AcquireRealmSourceMaterialization(ctx, accountRequest)
	if err != nil {
		return runtimeagentservice.RealmSourceMaterializationAcquisition{}, classifyAccountRealmSourceMaterializationAcquisitionError(err)
	}
	return runtimeagentservice.RealmSourceMaterializationAcquisition{
		AccountLease: runtimeagentservice.RealmSourceMaterializationAccountLease{
			AccountID: acquisition.AccountLease.AccountID, Generation: acquisition.AccountLease.Generation,
		},
		ExpectedIssuer:                    issuer.expectedIssuer,
		ExpectedAccessPolicyVersionDigest: sourceMaterializationAccessPolicyDigestV4,
		PacketResponse:                    runtimeAgentSourceMaterializationHTTPResponse(acquisition.PacketResponse),
	}, nil
}

func classifyAccountRealmSourceMaterializationAcquisitionError(err error) error {
	switch {
	case errors.Is(err, accountservice.ErrRealmSourceMaterializationInvalidRequest):
		return fmt.Errorf("%w: %v", runtimeagentservice.ErrRealmSourceMaterializationAcquisitionInvalidRequest, err)
	case errors.Is(err, accountservice.ErrRealmSourceMaterializationSourceBinding):
		return fmt.Errorf("%w: %v", runtimeagentservice.ErrRealmSourceMaterializationAcquisitionSourceBinding, err)
	case errors.Is(err, accountservice.ErrRealmSourceMaterializationDenied):
		return fmt.Errorf("%w: %v", runtimeagentservice.ErrRealmSourceMaterializationAcquisitionDenied, err)
	case errors.Is(err, accountservice.ErrRealmSourceMaterializationContract):
		return fmt.Errorf("%w: %v", runtimeagentservice.ErrRealmSourceMaterializationAcquisitionDenied, err)
	case errors.Is(err, accountservice.ErrRealmSourceMaterializationResponseSize):
		return fmt.Errorf("%w: %v", runtimeagentservice.ErrRealmSourceMaterializationAcquisitionCapacity, err)
	case errors.Is(err, accountservice.ErrRealmSourceMaterializationAccountLease):
		return fmt.Errorf("%w: %v", runtimeagentservice.ErrRealmSourceMaterializationAcquisitionAccount, err)
	default:
		return err
	}
}

func (issuer *accountRealmSourceMaterializationIssuer) FetchCurrentRealmSourceMaterializationJWKS(ctx context.Context, lease runtimeagentservice.RealmSourceMaterializationAccountLease) (runtimeagentservice.RealmSourceMaterializationHTTPResponse, error) {
	response, err := issuer.account.FetchCurrentRealmSourceMaterializationJWKS(ctx, accountservice.RealmSourceMaterializationAccountLease{
		AccountID: lease.AccountID, Generation: lease.Generation,
	})
	if err != nil {
		return runtimeagentservice.RealmSourceMaterializationHTTPResponse{}, err
	}
	return runtimeAgentSourceMaterializationHTTPResponse(response), nil
}

func (issuer *accountRealmSourceMaterializationIssuer) RevalidateRealmSourceMaterializationAccount(ctx context.Context, lease runtimeagentservice.RealmSourceMaterializationAccountLease) error {
	return issuer.account.RevalidateRealmSourceMaterializationAccount(ctx, accountservice.RealmSourceMaterializationAccountLease{
		AccountID: lease.AccountID, Generation: lease.Generation,
	})
}

func (issuer *accountRealmSourceMaterializationIssuer) WithCurrentRealmSourceMaterializationAccount(ctx context.Context, lease runtimeagentservice.RealmSourceMaterializationAccountLease, callback func() error) error {
	return issuer.account.WithCurrentRealmSourceMaterializationAccount(ctx, accountservice.RealmSourceMaterializationAccountLease{
		AccountID: lease.AccountID, Generation: lease.Generation,
	}, callback)
}

func runtimeAgentSourceMaterializationHTTPResponse(response accountservice.RealmSourceMaterializationHTTPResponse) runtimeagentservice.RealmSourceMaterializationHTTPResponse {
	return runtimeagentservice.RealmSourceMaterializationHTTPResponse{
		StatusCode: response.StatusCode, ContentType: response.ContentType,
		ContentEncoding: response.ContentEncoding, ContentLength: response.ContentLength, Body: response.Body,
	}
}
