package apppermission

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	permissionAuditDomain             = "local_app_permission"
	permissionDecisionAuditOperation  = "decision_transition"
	permissionOperationUseAuditAction = "operation_use"
)

type AuditSink interface {
	AppendEventChecked(*runtimev1.AuditEventRecord) error
}

type AuditEmitter struct {
	sink AuditSink
}

func NewAuditEmitter(sink AuditSink) *AuditEmitter {
	return &AuditEmitter{sink: sink}
}

type AuditBinding struct {
	OwnerSubjectID      string
	LocalAppPrincipalID string
	DisplayAppID        string
	PermissionID        string
	SelectorDigest      string
	OldPosture          Posture
	NewPosture          Posture
	Trigger             string
	Timestamp           time.Time
	OwnerRevision       uint64
}

type OperationUseAudit struct {
	Binding             AuditBinding
	ProtectedOperation  string
	ProtectedResourceID string
}

func (emitter *AuditEmitter) EmitDecisionTransition(_ context.Context, binding AuditBinding) error {
	return emitter.emit(permissionDecisionAuditOperation, binding, "", "")
}

func (emitter *AuditEmitter) EmitOperationUse(_ context.Context, input OperationUseAudit) error {
	if !exactAuditText(input.ProtectedOperation) || !exactAuditText(input.ProtectedResourceID) {
		return fmt.Errorf("protected operation and resource identity are required")
	}
	return emitter.emit(permissionOperationUseAuditAction, input.Binding, input.ProtectedOperation, input.ProtectedResourceID)
}

func (emitter *AuditEmitter) emit(action string, binding AuditBinding, protectedOperation string, protectedResourceID string) error {
	if emitter == nil || emitter.sink == nil {
		return fmt.Errorf("permission audit sink is unavailable")
	}
	if err := validateAuditBinding(binding); err != nil {
		return err
	}
	fields := map[string]any{
		"owner_subject_id":       binding.OwnerSubjectID,
		"local_app_principal_id": binding.LocalAppPrincipalID,
		"display_app_id":         binding.DisplayAppID,
		"permission_id":          binding.PermissionID,
		"selector_digest":        binding.SelectorDigest,
		"old_posture":            string(binding.OldPosture),
		"new_posture":            string(binding.NewPosture),
		"trigger":                binding.Trigger,
		"timestamp":              binding.Timestamp.Format(time.RFC3339Nano),
		"owner_revision":         strconv.FormatUint(binding.OwnerRevision, 10),
	}
	if protectedOperation != "" {
		fields["protected_operation_id"] = protectedOperation
		fields["protected_resource_id"] = protectedResourceID
	}
	payload, err := structpb.NewStruct(fields)
	if err != nil {
		return fmt.Errorf("build permission audit payload: %w", err)
	}
	event := &runtimev1.AuditEventRecord{
		AppId: binding.DisplayAppID, SubjectUserId: binding.OwnerSubjectID,
		Domain: permissionAuditDomain, Operation: action, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		Timestamp: timestamppb.New(binding.Timestamp), Payload: payload,
		CallerKind: runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP, CallerId: binding.LocalAppPrincipalID,
		PrincipalId: binding.LocalAppPrincipalID, PrincipalType: "local_app_principal",
		Capability: binding.PermissionID, ResourceSelectorHash: binding.SelectorDigest,
		PolicyVersion: strconv.FormatUint(binding.OwnerRevision, 10),
	}
	if err := emitter.sink.AppendEventChecked(event); err != nil {
		return fmt.Errorf("persist permission audit event: %w", err)
	}
	return nil
}

func validateAuditBinding(binding AuditBinding) error {
	for name, value := range map[string]string{
		"owner subject":   binding.OwnerSubjectID,
		"app principal":   binding.LocalAppPrincipalID,
		"display app id":  binding.DisplayAppID,
		"permission id":   binding.PermissionID,
		"selector digest": binding.SelectorDigest,
		"trigger":         binding.Trigger,
	} {
		if !exactAuditText(value) {
			return fmt.Errorf("permission audit %s is invalid", name)
		}
	}
	if !validPublicPosture(binding.OldPosture) || !validPublicPosture(binding.NewPosture) {
		return fmt.Errorf("permission audit posture is invalid")
	}
	if binding.Timestamp.IsZero() || binding.Timestamp.Location() != time.UTC || binding.OwnerRevision == 0 {
		return fmt.Errorf("permission audit timestamp or owner revision is invalid")
	}
	return nil
}

func validPublicPosture(posture Posture) bool {
	switch posture {
	case PosturePrompt, PosturePending, PostureGranted, PostureDenied, PostureUnavailable:
		return true
	default:
		return false
	}
}

func exactAuditText(value string) bool {
	return value != "" && value == strings.TrimSpace(value)
}
