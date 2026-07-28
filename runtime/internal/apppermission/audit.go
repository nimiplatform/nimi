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
	return emitter.emit(permissionDecisionAuditOperation, binding, "", "", false)
}

// EmitPendingRequestTransition records the selector-free prompt-to-pending
// boundary. A selector digest cannot exist until the owner chooses a resource.
func (emitter *AuditEmitter) EmitPendingRequestTransition(_ context.Context, binding AuditBinding) error {
	if binding.SelectorDigest != "" || binding.OldPosture != PosturePrompt || binding.NewPosture != PosturePending || binding.Trigger != "app_request" {
		return fmt.Errorf("permission pending-request audit binding is invalid")
	}
	return emitter.emit(permissionDecisionAuditOperation, binding, "", "", true)
}

// EmitPendingRequestDenial records an owner denial without inventing a
// selector for a resource the owner did not choose.
func (emitter *AuditEmitter) EmitPendingRequestDenial(_ context.Context, binding AuditBinding) error {
	if binding.SelectorDigest != "" || binding.OldPosture != PosturePending || binding.NewPosture != PostureDenied || binding.Trigger != "owner_deny" {
		return fmt.Errorf("permission pending-request denial audit binding is invalid")
	}
	return emitter.emit(permissionDecisionAuditOperation, binding, "", "", true)
}

func (emitter *AuditEmitter) EmitOperationUse(_ context.Context, input OperationUseAudit) error {
	if !exactAuditText(input.ProtectedOperation) || !exactAuditText(input.ProtectedResourceID) {
		return fmt.Errorf("protected operation and resource identity are required")
	}
	return emitter.emit(permissionOperationUseAuditAction, input.Binding, input.ProtectedOperation, input.ProtectedResourceID, false)
}

func (emitter *AuditEmitter) emit(action string, binding AuditBinding, protectedOperation string, protectedResourceID string, selectorPending bool) error {
	if emitter == nil || emitter.sink == nil {
		return fmt.Errorf("permission audit sink is unavailable")
	}
	if err := validateAuditBinding(binding, selectorPending); err != nil {
		return err
	}
	fields := map[string]any{
		"owner_subject_id":       binding.OwnerSubjectID,
		"local_app_principal_id": binding.LocalAppPrincipalID,
		"display_app_id":         binding.DisplayAppID,
		"permission_id":          binding.PermissionID,
		"old_posture":            string(binding.OldPosture),
		"new_posture":            string(binding.NewPosture),
		"trigger":                binding.Trigger,
		"timestamp":              binding.Timestamp.Format(time.RFC3339Nano),
		"owner_revision":         strconv.FormatUint(binding.OwnerRevision, 10),
	}
	if !selectorPending {
		fields["selector_digest"] = binding.SelectorDigest
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

func validateAuditBinding(binding AuditBinding, selectorPending bool) error {
	for name, value := range map[string]string{
		"owner subject":  binding.OwnerSubjectID,
		"app principal":  binding.LocalAppPrincipalID,
		"display app id": binding.DisplayAppID,
		"permission id":  binding.PermissionID,
		"trigger":        binding.Trigger,
	} {
		if !exactAuditText(value) {
			return fmt.Errorf("permission audit %s is invalid", name)
		}
	}
	if !selectorPending && !exactAuditText(binding.SelectorDigest) {
		return fmt.Errorf("permission audit selector digest is invalid")
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
