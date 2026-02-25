package grpcserver

import (
	"crypto/sha256"
	"encoding/hex"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
	"strings"
	"time"
)

type auditEventInput struct {
	AppID                 string
	SubjectUserID         string
	Domain                string
	Operation             string
	Capability            string
	ReasonCode            runtimev1.ReasonCode
	TraceID               string
	CallerKind            runtimev1.CallerKind
	CallerID              string
	SurfaceID             string
	TokenID               string
	ParentTokenID         string
	ConsentID             string
	ConsentVersion        string
	PolicyVersion         string
	ResourceSelectorHash  string
	ScopeCatalogVersion   string
	ExternalPrincipalType string
	PrincipalID           string
	PrincipalType         string
	Payload               map[string]any
}

func appendAuditEvent(store *auditlog.Store, input auditEventInput) {
	if store == nil {
		return
	}
	if input.TraceID == "" {
		input.TraceID = ulid.Make().String()
	}
	payload, _ := structpb.NewStruct(input.Payload)
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AppId:                 input.AppID,
		SubjectUserId:         input.SubjectUserID,
		Domain:                input.Domain,
		Operation:             input.Operation,
		ReasonCode:            input.ReasonCode,
		TraceId:               input.TraceID,
		Timestamp:             timestamppb.New(time.Now().UTC()),
		Payload:               payload,
		CallerKind:            input.CallerKind,
		CallerId:              input.CallerID,
		SurfaceId:             input.SurfaceID,
		PrincipalId:           input.PrincipalID,
		PrincipalType:         input.PrincipalType,
		ExternalPrincipalType: input.ExternalPrincipalType,
		Capability:            input.Capability,
		TokenId:               input.TokenID,
		ParentTokenId:         input.ParentTokenID,
		ConsentId:             input.ConsentID,
		ConsentVersion:        input.ConsentVersion,
		PolicyVersion:         input.PolicyVersion,
		ResourceSelectorHash:  input.ResourceSelectorHash,
		ScopeCatalogVersion:   input.ScopeCatalogVersion,
	})
}

type grantAuditDetails struct {
	TokenID               string
	ParentTokenID         string
	ConsentID             string
	ConsentVersion        string
	PolicyVersion         string
	ResourceSelectorHash  string
	ScopeCatalogVersion   string
	ExternalPrincipalType string
}

func inferGrantAuditDetails(req any, resp any) grantAuditDetails {
	var details grantAuditDetails

	switch value := req.(type) {
	case *runtimev1.AuthorizeExternalPrincipalRequest:
		details.ConsentID = strings.TrimSpace(value.GetConsentId())
		details.ConsentVersion = strings.TrimSpace(value.GetConsentVersion())
		details.PolicyVersion = strings.TrimSpace(value.GetPolicyVersion())
		details.ScopeCatalogVersion = strings.TrimSpace(value.GetScopeCatalogVersion())
		details.ExternalPrincipalType = strings.TrimSpace(value.GetExternalPrincipalType().String())
		details.ResourceSelectorHash = hashResourceSelectors(value.GetResourceSelectors())
	case *runtimev1.RevokeAppAccessTokenRequest:
		details.TokenID = strings.TrimSpace(value.GetTokenId())
	case *runtimev1.ValidateAppAccessTokenRequest:
		details.TokenID = strings.TrimSpace(value.GetTokenId())
		details.ResourceSelectorHash = hashResourceSelectors(value.GetResourceSelectors())
	case *runtimev1.IssueDelegatedAccessTokenRequest:
		details.ParentTokenID = strings.TrimSpace(value.GetParentTokenId())
		details.ResourceSelectorHash = hashResourceSelectors(value.GetResourceSelectors())
	}

	switch value := resp.(type) {
	case *runtimev1.AuthorizeExternalPrincipalResponse:
		if details.TokenID == "" {
			details.TokenID = strings.TrimSpace(value.GetTokenId())
		}
		if details.PolicyVersion == "" {
			details.PolicyVersion = strings.TrimSpace(value.GetPolicyVersion())
		}
		if details.ScopeCatalogVersion == "" {
			details.ScopeCatalogVersion = strings.TrimSpace(value.GetIssuedScopeCatalogVersion())
		}
	case *runtimev1.IssueDelegatedAccessTokenResponse:
		if details.TokenID == "" {
			details.TokenID = strings.TrimSpace(value.GetTokenId())
		}
		if details.ParentTokenID == "" {
			details.ParentTokenID = strings.TrimSpace(value.GetParentTokenId())
		}
	case *runtimev1.ValidateAppAccessTokenResponse:
		if details.PolicyVersion == "" {
			details.PolicyVersion = strings.TrimSpace(value.GetPolicyVersion())
		}
		if details.ScopeCatalogVersion == "" {
			details.ScopeCatalogVersion = strings.TrimSpace(value.GetIssuedScopeCatalogVersion())
		}
	}

	return details
}

func hashResourceSelectors(selectors *runtimev1.ResourceSelectors) string {
	if selectors == nil {
		return ""
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(selectors)
	if err != nil || len(raw) == 0 {
		return ""
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
