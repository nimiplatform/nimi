package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
)

func (s *Service) AuthorizeMemoryEmbeddingTarget(_ context.Context, reqContext *runtimev1.MemoryRequestContext, locator *runtimev1.MemoryBankLocator) error {
	if locator == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		localAgentRef := strings.TrimSpace(locator.GetAgentCore().GetAgentId())
		subjectUserID := strings.TrimSpace(reqContext.GetSubjectUserId())
		if localAgentRef == "" || subjectUserID == "" {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		}
		entry, err := s.agentByID(localAgentRef)
		if err != nil {
			return grpcerr.WrapWithReasonCode(
				codes.PermissionDenied,
				runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
				err,
				grpcerr.ReasonOptions{
					ActionHint: "verify_runtime_agent_identity",
					Message:    "memory embedding target could not be authorized",
				},
			)
		}
		if strings.TrimSpace(entry.Agent.GetLocalAgentRef()) != localAgentRef ||
			strings.TrimSpace(entry.Agent.GetOwnerUserId()) != subjectUserID {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		}
		return nil
	default:
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
}

// @nimi-authority: rule.nimi.runtime.security-core.r064
func (s *Service) ResolveMemoryEmbeddingIntent(ctx context.Context, reqContext *runtimev1.MemoryRequestContext, locator *runtimev1.MemoryBankLocator) (*memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot, error) {
	if err := s.AuthorizeMemoryEmbeddingTarget(ctx, reqContext, locator); err != nil {
		return nil, err
	}
	accountNamespace := strings.TrimSpace(reqContext.GetSubjectUserId())
	config, err := s.requireSharedLocalAgentAIConfig(ctx, accountNamespace)
	if err != nil {
		return nil, err
	}
	var embeddingIntent *runtimev1.AIConfigCapabilityIntent
	for _, capability := range config.GetCapabilities() {
		if strings.TrimSpace(capability.GetCapabilityContract()) == capabilitydriver.TextEmbedCapabilityContract {
			embeddingIntent = capability
			break
		}
	}
	if embeddingIntent == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	snapshot := &memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot{
		RevisionToken: aiconfig.Hash(config),
	}
	if embeddingIntent.GetLocal() != nil {
		snapshot.SourceKind = memoryservice.MemoryEmbeddingTextEmbedSourceKindLocal
		snapshot.LocalBinding = &memoryservice.MemoryEmbeddingLocalBindingRef{}
		return snapshot, nil
	}
	if embeddingIntent.GetCloud() == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	binding, err := (&selectedLocalMachineExecutionBindingResolver{owner: s}).resolveCloudMachineExecutionBinding(accountNamespace, embeddingIntent)
	if err != nil {
		return nil, err
	}
	cloud := binding.TargetRef.Cloud
	if cloud == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEMORY_EMBEDDING_TARGET_REF_INVALID)
	}
	snapshot.SourceKind = memoryservice.MemoryEmbeddingTextEmbedSourceKindCloud
	snapshot.CloudBinding = &memoryservice.MemoryEmbeddingCloudBindingRef{
		ConnectorID:          cloud.ConnectorID,
		RemoteModelCatalogID: cloud.RemoteModelCatalogID,
		ProviderModelID:      cloud.ProviderModelID,
		Provider:             cloud.Provider,
	}
	return snapshot, nil
}
