package runtimeagent

import (
	"context"
	"encoding/hex"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const maxLocalAppAgentInventoryEntries = 200

func (s *Service) ListLocalAppAgentInventory(
	ctx context.Context,
	req *runtimev1.ListLocalAppAgentInventoryRequest,
) (*runtimev1.ListLocalAppAgentInventoryResponse, error) {
	if s == nil || s.isClosed() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	caller, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || caller.Operation != "" || caller.TrustClass != accountservice.LocalAppTrustClassDevelopment ||
		caller.SessionID == (accountservice.LocalAppCallerDecision{}).SessionID || caller.AccountGeneration == 0 ||
		strings.TrimSpace(caller.AccountID) == "" || strings.TrimSpace(caller.LocalOSUserAnchor) == "" ||
		strings.TrimSpace(caller.LocalAppPrincipalID) == "" || strings.TrimSpace(caller.LocalAppRecordID) == "" {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	auditStore := s.localAppAgentInventoryAuditStore()
	if auditStore == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}

	type inventoryRow struct {
		createdAt time.Time
		item      *runtimev1.LocalAppAgentInventoryItem
	}
	s.mu.RLock()
	rows := make([]inventoryRow, 0, len(s.agents))
	for _, entry := range s.agents {
		if entry == nil || entry.Agent == nil || entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE ||
			strings.TrimSpace(entry.Agent.GetOwnerUserId()) != caller.AccountID {
			continue
		}
		identity, err := validateLocalAgentIdentity(
			entry.Agent.GetOwnerUserId(),
			entry.Agent.GetRuntimeSourceRef(),
			entry.Agent.GetLocalAgentRef(),
		)
		if err != nil || identity.OwnerUserID != caller.AccountID || strings.TrimSpace(entry.Agent.GetDisplayName()) == "" {
			s.mu.RUnlock()
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		rows = append(rows, inventoryRow{
			createdAt: entry.Agent.GetCreatedAt().AsTime(),
			item: &runtimev1.LocalAppAgentInventoryItem{
				LocalAgentRef:    identity.LocalAgentRef,
				DisplayName:      strings.TrimSpace(entry.Agent.GetDisplayName()),
				OwnerUserId:      identity.OwnerUserID,
				RuntimeSourceRef: identity.RuntimeSourceRef,
				SourceReady:      entry.Agent.GetSourceContextStatus().GetReady(),
			},
		})
	}
	s.mu.RUnlock()
	if len(rows) > maxLocalAppAgentInventoryEntries {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].createdAt.Equal(rows[j].createdAt) {
			return rows[i].item.GetLocalAgentRef() < rows[j].item.GetLocalAgentRef()
		}
		return rows[i].createdAt.After(rows[j].createdAt)
	})
	items := make([]*runtimev1.LocalAppAgentInventoryItem, len(rows))
	for index := range rows {
		items[index] = rows[index].item
	}
	s.appendLocalAppAgentInventoryAudit(auditStore, caller, len(items))
	return &runtimev1.ListLocalAppAgentInventoryResponse{
		OwnerUserId: caller.AccountID,
		Count:       uint32(len(items)),
		LocalAgents: items,
	}, nil
}

func (s *Service) localAppAgentInventoryAuditStore() *auditlog.Store {
	if s == nil {
		return nil
	}
	s.execAuditMu.Lock()
	defer s.execAuditMu.Unlock()
	return s.auditStore
}

func (s *Service) appendLocalAppAgentInventoryAudit(
	store *auditlog.Store,
	caller accountservice.LocalAppCallerDecision,
	count int,
) {
	now := time.Now().UTC()
	traceID := ulid.Make().String()
	payload, _ := structpb.NewStruct(map[string]any{
		"local_app_principal_id": caller.LocalAppPrincipalID,
		"local_app_record_id":    caller.LocalAppRecordID,
		"local_os_user_anchor":   caller.LocalOSUserAnchor,
		"session_id":             hex.EncodeToString(caller.SessionID[:]),
		"account_generation":     caller.AccountGeneration,
		"result_count":           count,
	})
	store.AppendEvent(&runtimev1.AuditEventRecord{
		AppId:         caller.AppID,
		SubjectUserId: caller.AccountID,
		Domain:        "runtime.local_app_agent_inventory",
		Operation:     "inventory.list",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       traceID,
		RequestId:     traceID,
		Timestamp:     timestamppb.New(now),
		Payload:       payload,
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP,
		CallerId:      caller.LocalAppPrincipalID,
		PrincipalId:   caller.LocalAppPrincipalID,
		PrincipalType: "local_app",
		SurfaceId:     "runtime.agent.local_app_inventory",
	})
}
