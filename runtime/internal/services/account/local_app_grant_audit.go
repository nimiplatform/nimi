package account

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const localAppGrantNoGrantState = "no_grant"

func (s *Service) requireLocalAppGrantAudit() error {
	if s == nil || s.auditStore == nil {
		return ErrLocalAppOperationNotAdmitted
	}
	return nil
}

func (s *Service) transitionLocalAppGrant(
	ctx context.Context,
	current localappkernel.Grant,
	target localappkernel.GrantState,
	presenceEvidenceRef string,
	appID string,
	operationID string,
	triggeredBy string,
) (localappkernel.Grant, error) {
	if err := s.requireLocalAppGrantAudit(); err != nil {
		return localappkernel.Grant{}, err
	}
	next, err := s.localAppKernel.Grants().Transition(
		ctx,
		current.AccountID,
		current.LocalAppPrincipalID,
		current.CapabilityResourceFingerprint,
		current.GrantRevision,
		target,
		presenceEvidenceRef,
	)
	if err != nil {
		return localappkernel.Grant{}, err
	}
	s.appendLocalAppGrantTransitionAudit(next, appID, string(current.State), operationID, triggeredBy)
	return next, nil
}

func (s *Service) appendLocalAppGrantTransitionAudit(
	grant localappkernel.Grant,
	appID string,
	oldState string,
	operationID string,
	triggeredBy string,
) {
	if s == nil || s.auditStore == nil {
		return
	}
	now := s.now().UTC()
	traceID := ulid.Make().String()
	scopeName := firstString(grant.CapabilityScope)
	appID = strings.TrimSpace(appID)
	payload := &structpb.Struct{Fields: map[string]*structpb.Value{
		"local_app_principal_id": structpb.NewStringValue(grant.LocalAppPrincipalID),
		"app_id":                 structpb.NewStringValue(appID),
		"ai_scope_ref": structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
			"kind":    structpb.NewStringValue("app"),
			"ownerId": structpb.NewStringValue(appID),
		}}),
		"scope_name":             structpb.NewStringValue(scopeName),
		"operation_id":           structpb.NewStringValue(strings.TrimSpace(operationID)),
		"resource_impact_digest": structpb.NewStringValue(grant.CapabilityResourceFingerprint),
		"grant_id":               structpb.NewStringValue(grant.GrantID),
		"grant_generation":       structpb.NewNumberValue(float64(grant.GrantGeneration)),
		"grant_revision":         structpb.NewNumberValue(float64(grant.GrantRevision)),
		"old_state":              structpb.NewStringValue(oldState),
		"new_state":              structpb.NewStringValue(string(grant.State)),
		"triggered_by":           structpb.NewStringValue(triggeredBy),
		"timestamp":              structpb.NewStringValue(now.Format(time.RFC3339Nano)),
	}}
	s.auditStore.AppendEvent(&runtimev1.AuditEventRecord{
		AppId:                appID,
		SubjectUserId:        grant.AccountID,
		Domain:               "runtime.local_app_grant",
		Operation:            "grant.transition",
		ReasonCode:           runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:              traceID,
		RequestId:            traceID,
		Timestamp:            timestamppb.New(now),
		Payload:              payload,
		CallerKind:           runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP,
		CallerId:             grant.LocalAppPrincipalID,
		PrincipalId:          grant.LocalAppPrincipalID,
		PrincipalType:        "local_app",
		Capability:           scopeName,
		ResourceSelectorHash: grant.CapabilityResourceFingerprint,
	})
}
