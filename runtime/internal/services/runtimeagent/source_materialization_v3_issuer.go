package runtimeagent

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

var (
	// ErrRealmSourceMaterializationAcquisitionDenied marks a canonical Realm
	// grant response that is non-authorizing or contract-invalid. It is distinct
	// from transport availability so public consumers receive the closed denial
	// outcome required by the materialization contract.
	ErrRealmSourceMaterializationAcquisitionDenied         = errors.New("Realm source materialization acquisition denied")
	ErrRealmSourceMaterializationAcquisitionInvalidRequest = errors.New("Realm source materialization acquisition request is invalid")
	ErrRealmSourceMaterializationAcquisitionSourceBinding  = errors.New("Realm source materialization acquisition source binding rejected")
	ErrRealmSourceMaterializationAcquisitionCapacity       = errors.New("Realm source materialization acquisition exceeds capacity")
	ErrRealmSourceMaterializationAcquisitionAccount        = errors.New("Realm source materialization acquisition account changed")
)

// RealmSourceMaterializationIssuer is the Runtime-private account/Realm seam.
// Implementations own bearer refresh, exact current-grant selection and the
// fixed Realm origin. No bearer, grant record, base URL or packet bytes cross
// this interface into a public RPC or protected broker.
type RealmSourceMaterializationIssuer interface {
	AcquireRealmSourceMaterialization(context.Context, RealmSourceMaterializationIssuanceRequest) (RealmSourceMaterializationAcquisition, error)
	FetchCurrentRealmSourceMaterializationJWKS(context.Context, RealmSourceMaterializationAccountLease) (RealmSourceMaterializationHTTPResponse, error)
	RevalidateRealmSourceMaterializationAccount(context.Context, RealmSourceMaterializationAccountLease) error
	WithCurrentRealmSourceMaterializationAccount(context.Context, RealmSourceMaterializationAccountLease, func() error) error
}

type RealmSourceMaterializationAccountLease struct {
	AccountID  string
	Generation uint64
}

type RealmSourceMaterializationWorldEntityRefV3 struct {
	WorldID  string
	EntityID string
}

type RealmSourceMaterializationSourceRefV3 struct {
	Kind           string
	ID             string
	WorldID        string
	WorldEntityRef *RealmSourceMaterializationWorldEntityRefV3
	OwnerAccountID string
	SourceHash     string
}

type RealmSourceMaterializationLimitsV3 struct {
	MaxSegmentBytes          uint64
	MaxSegmentComponentCount uint64
	MaxChunkBytes            uint64
	MaxSegmentChunks         uint64
	MaxSetSegments           uint64
	MaxSetBytes              uint64
	MaxSetComponentCount     uint64
	MaxSetChunks             uint64
}

type RealmSourceMaterializationChallengeV3 struct {
	ChallengeID             string
	ChallengeDigest         string
	IntendedRuntimeAudience string
	IssuedAt                time.Time
	ExpiresAt               time.Time
}

type RealmSourceMaterializationIssuanceRequest struct {
	AuthenticatedAccountID string
	RequestID              string
	SourceRef              RealmSourceMaterializationSourceRefV3
	Challenge              RealmSourceMaterializationChallengeV3
	Limits                 RealmSourceMaterializationLimitsV3
}

type RealmSourceMaterializationAcquisition struct {
	AccountLease                      RealmSourceMaterializationAccountLease
	ExpectedIssuer                    string
	ExpectedAccessPolicyVersionDigest string
	PacketResponse                    RealmSourceMaterializationHTTPResponse
}

type RealmSourceMaterializationHTTPResponse struct {
	StatusCode      int
	ContentType     string
	ContentEncoding string
	ContentLength   int64
	Body            io.ReadCloser
}

func (r RealmSourceMaterializationHTTPResponse) close() {
	if r.Body != nil {
		_ = r.Body.Close()
	}
}

func (r RealmSourceMaterializationSourceRefV3) internal() (sourceMaterializationCharacterSourceRefV3, error) {
	result := sourceMaterializationCharacterSourceRefV3{
		Kind: r.Kind, ID: r.ID, WorldID: r.WorldID, OwnerAccountID: r.OwnerAccountID, SourceHash: r.SourceHash,
	}
	if r.WorldEntityRef != nil {
		result.WorldEntityRef = &sourceMaterializationWorldEntityRefV3{Kind: "worldEntity", WorldID: r.WorldEntityRef.WorldID, EntityID: r.WorldEntityRef.EntityID}
	}
	if err := result.validate(); err != nil {
		return sourceMaterializationCharacterSourceRefV3{}, err
	}
	return result, nil
}

func sourceMaterializationExternalRefV3(r sourceMaterializationCharacterSourceRefV3) RealmSourceMaterializationSourceRefV3 {
	result := RealmSourceMaterializationSourceRefV3{
		Kind: r.Kind, ID: r.ID, WorldID: r.WorldID, OwnerAccountID: r.OwnerAccountID, SourceHash: r.SourceHash,
	}
	if r.WorldEntityRef != nil {
		result.WorldEntityRef = &RealmSourceMaterializationWorldEntityRefV3{WorldID: r.WorldEntityRef.WorldID, EntityID: r.WorldEntityRef.EntityID}
	}
	return result
}

func sourceMaterializationExternalLimitsV3(l sourceMaterializationPublishedLimitsV3) RealmSourceMaterializationLimitsV3 {
	return RealmSourceMaterializationLimitsV3{
		MaxSegmentBytes: l.MaxSegmentBytes, MaxSegmentComponentCount: l.MaxSegmentComponentCount,
		MaxChunkBytes: l.MaxChunkBytes, MaxSegmentChunks: l.MaxSegmentChunks,
		MaxSetSegments: l.MaxSetSegments, MaxSetBytes: l.MaxSetBytes,
		MaxSetComponentCount: l.MaxSetComponentCount, MaxSetChunks: l.MaxSetChunks,
	}
}

func validateSourceMaterializationAcquisitionV3(acquisition RealmSourceMaterializationAcquisition, accountID string) error {
	if acquisition.AccountLease.AccountID != accountID || acquisition.AccountLease.Generation == 0 {
		return sourceMaterializationV3Error(sourceMaterializationFailureAccountBindingV3, "issuer account lease is invalid")
	}
	if acquisition.ExpectedIssuer == "" || acquisition.ExpectedIssuer != strings.TrimSpace(acquisition.ExpectedIssuer) {
		return sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "expected Realm issuer is unavailable")
	}
	if !isLowerSHA256V3(acquisition.ExpectedAccessPolicyVersionDigest) {
		return sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "expected access policy version digest is unavailable")
	}
	if acquisition.PacketResponse.Body == nil {
		return sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "Realm packet response body is unavailable")
	}
	return nil
}

func validateSourceMaterializationHTTPResponseV3(response RealmSourceMaterializationHTTPResponse, expectedStatus int, maxBytes int64) error {
	if response.StatusCode != expectedStatus {
		return sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "Realm returned HTTP status %d", response.StatusCode)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.ContentType, ";")[0]))
	if contentType != sourceMaterializationPacketContentTypeV3 && !strings.HasSuffix(contentType, "+json") {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Realm response content type is not JSON")
	}
	encoding := strings.ToLower(strings.TrimSpace(response.ContentEncoding))
	if encoding != "" && encoding != "identity" {
		return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "compressed Realm response is not admitted")
	}
	if maxBytes <= 0 {
		return fmt.Errorf("source materialization response limit is invalid")
	}
	if response.ContentLength > maxBytes {
		return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Realm response Content-Length exceeds the wire budget")
	}
	return nil
}
