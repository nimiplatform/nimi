package runtimeagent

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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

func (s *Service) ResolveMemoryEmbeddingIntent(ctx context.Context, reqContext *runtimev1.MemoryRequestContext, locator *runtimev1.MemoryBankLocator) (*memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot, error) {
	if err := s.AuthorizeMemoryEmbeddingTarget(ctx, reqContext, locator); err != nil {
		return nil, err
	}
	agentInstanceID := strings.TrimSpace(locator.GetAgentCore().GetAgentId())
	if agentInstanceID == "" {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	config, err := s.committedRuntimeAgentAIConfigByAgentInstanceID(agentInstanceID)
	if err != nil {
		return nil, err
	}
	for _, intent := range config.GetIntents() {
		if strings.TrimSpace(intent.GetCapability()) != runtimeAgentAIConfigCapabilityTextEmbed {
			continue
		}
		return memoryEmbeddingTextEmbedIntentFromRuntimeAgentAIConfig(config, intent), nil
	}
	return nil, nil
}

func memoryEmbeddingTextEmbedIntentFromRuntimeAgentAIConfig(config *runtimev1.RuntimeAgentAIConfig, intent *runtimev1.RuntimeAgentAIConfigIntent) *memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot {
	if config == nil || intent == nil {
		return nil
	}
	snapshot := &memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot{
		ConfigRevision: config.GetRevision(),
		RevisionToken:  fmt.Sprintf("runtime-agent-ai-config:%s:%d:%s", config.GetAgentInstanceId(), config.GetRevision(), runtimeAgentAIConfigCapabilityTextEmbed),
	}
	switch intent.GetRoutePolicy() {
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL:
		snapshot.SourceKind = memoryservice.MemoryEmbeddingTextEmbedSourceKindLocal
		local := intent.GetTargetRef().GetLocalRuntime()
		profileBindingID := strings.TrimSpace(local.GetProfileBindingId())
		readinessRef := strings.TrimSpace(local.GetReadinessRef())
		if profileBindingID == "" && readinessRef == "" {
			return nil
		}
		snapshot.LocalBinding = &memoryservice.MemoryEmbeddingLocalBindingRef{
			ProfileBindingID: profileBindingID,
			ReadinessRef:     readinessRef,
		}
	case runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD:
		snapshot.SourceKind = memoryservice.MemoryEmbeddingTextEmbedSourceKindCloud
		cloud := intent.GetTargetRef().GetCloud()
		snapshot.CloudBinding = &memoryservice.MemoryEmbeddingCloudBindingRef{
			ConnectorID:          firstNonEmpty(intent.GetConnectorId(), cloud.GetConnectorId()),
			RemoteModelCatalogID: strings.TrimSpace(cloud.GetRemoteModelCatalogId()),
			ProviderModelID:      firstNonEmpty(cloud.GetProviderModelId(), intent.GetModelId()),
			Provider:             strings.TrimSpace(cloud.GetProvider()),
		}
	default:
		return nil
	}
	return snapshot
}
