package grpcserver

import (
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type auditEventInput struct {
	AppID                 string
	SubjectUserID         string
	Domain                string
	Operation             string
	Capability            string
	ReasonCode            runtimev1.ReasonCode
	TraceID               string
	RequestID             string
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
	// K-AUDIT-003: baseline request_id == trace_id when no explicit request_id is set.
	if input.RequestID == "" {
		input.RequestID = input.TraceID
	}
	payload := auditEventPayload(input.Payload)
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AppId:                 input.AppID,
		SubjectUserId:         input.SubjectUserID,
		Domain:                input.Domain,
		Operation:             input.Operation,
		ReasonCode:            input.ReasonCode,
		TraceId:               input.TraceID,
		RequestId:             input.RequestID,
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

func auditEventPayload(fields map[string]any) *structpb.Struct {
	payload, err := structpb.NewStruct(fields)
	if err == nil {
		return payload
	}
	fallback, _ := structpb.NewStruct(map[string]any{
		"payload_encode_error": err.Error(),
	})
	return fallback
}
