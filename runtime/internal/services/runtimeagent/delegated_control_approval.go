package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) validateDelegatedApprovalResumeLocked(ctx *runtimev1.AgentRequestContext, agentID string, approval *runtimev1.DelegatedApprovalRequest, now time.Time) error {
	if approval == nil {
		return status.Error(codes.NotFound, "delegated approval request not found")
	}
	if approval.GetExpiresAt() == nil {
		return status.Error(codes.FailedPrecondition, "delegated approval request expiry is required")
	}
	if !approval.GetExpiresAt().AsTime().After(now) {
		approval.State = runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_EXPIRED
		approval.UpdatedAt = timestamppb.New(now)
		return status.Error(codes.FailedPrecondition, "delegated approval request expired")
	}
	fields := approval.GetDetail().GetFields()
	descriptorHash := structStringField(fields, "descriptor_hash")
	policySnapshotID := structStringField(fields, "policy_snapshot_id")
	principalID := structStringField(fields, "principal_id")
	if descriptorHash == "" || policySnapshotID == "" || principalID == "" {
		return status.Error(codes.FailedPrecondition, "delegated approval request missing policy snapshot, descriptor, or principal lineage")
	}
	currentPrincipal := delegatedApprovalPrincipalID(ctx)
	if currentPrincipal == "" || currentPrincipal != principalID {
		return status.Error(codes.PermissionDenied, "delegated approval principal is not authorized for this request")
	}
	profile := s.delegatedProviderProfiles[delegatedProviderProfileKey(agentID, approval.GetProviderProfileId())]
	if profile == nil {
		return status.Error(codes.FailedPrecondition, "delegated approval provider profile is unavailable")
	}
	if profile.GetState() != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY {
		return status.Error(codes.FailedPrecondition, "delegated approval provider profile is not ready")
	}
	currentDescriptor := delegatedProviderToolDescriptorHash(profile, approval.GetToolName())
	if currentDescriptor == "" {
		return status.Error(codes.FailedPrecondition, "delegated approval capability descriptor is unavailable")
	}
	if currentDescriptor != descriptorHash {
		return status.Error(codes.FailedPrecondition, "delegated approval descriptor drifted")
	}
	// K-DELEG-093 resume precondition: the request effect class must be a
	// resolved classification and must still match the current capability
	// descriptor. This fails closed on an approval that hydrated from a
	// pre-classification persisted profile (UNSPECIFIED effect) or whose
	// declared effect drifted after the approval was recorded.
	if approval.GetEffectClass() == runtimev1.EffectClass_EFFECT_CLASS_UNSPECIFIED {
		return status.Error(codes.FailedPrecondition, "delegated approval effect class is unclassified")
	}
	currentEffectClass := effectiveDelegatedEffectClass(deriveDelegatedToolEffectClass(profile, approval.GetToolName()))
	if currentEffectClass != approval.GetEffectClass() {
		return status.Error(codes.FailedPrecondition, "delegated approval effect class drifted")
	}
	expectedPolicySnapshotID := delegatedApprovalPolicySnapshotID(
		approval.GetProviderProfileId(),
		approval.GetCapabilityId(),
		approval.GetToolName(),
		descriptorHash,
	)
	if policySnapshotID != expectedPolicySnapshotID {
		return status.Error(codes.FailedPrecondition, "delegated approval policy snapshot drifted")
	}
	return nil
}

func (s *Service) persistDelegatedApprovalExpiryIfNeededLocked(approval *runtimev1.DelegatedApprovalRequest, validationErr error) error {
	if validationErr == nil || approval == nil {
		return validationErr
	}
	if approval.GetState() != runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_EXPIRED {
		return validationErr
	}
	if err := s.persistDelegatedControlStateLocked(); err != nil {
		return grpcerr.WrapWithReasonCode(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "delegated approval expiry could not be persisted"},
		)
	}
	return validationErr
}

func delegatedApprovalPrincipalID(ctx *runtimev1.AgentRequestContext) string {
	if ctx == nil {
		return ""
	}
	return firstNonEmpty(strings.TrimSpace(ctx.GetSubjectUserId()), strings.TrimSpace(ctx.GetAppId()))
}

func delegatedApprovalPolicySnapshotID(providerID string, capabilityID string, toolName string, descriptorHash string) string {
	providerID = strings.TrimSpace(providerID)
	capabilityID = strings.TrimSpace(capabilityID)
	toolName = strings.TrimSpace(toolName)
	descriptorHash = strings.TrimSpace(descriptorHash)
	if providerID == "" || capabilityID == "" || toolName == "" || descriptorHash == "" {
		return ""
	}
	return strings.Join([]string{"deleg-policy", providerID, capabilityID, toolName, descriptorHash}, ":")
}

func delegatedProviderToolDescriptorHash(profile *runtimev1.DelegatedProviderProfile, toolName string) string {
	toolName = strings.TrimSpace(toolName)
	if profile == nil || toolName == "" {
		return ""
	}
	for _, tool := range profile.GetAllowedTools() {
		if strings.TrimSpace(tool.GetToolName()) == toolName {
			return strings.TrimSpace(tool.GetInputSchemaDigest())
		}
	}
	return ""
}
