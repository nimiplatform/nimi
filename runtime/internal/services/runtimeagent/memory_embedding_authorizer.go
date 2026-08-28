package runtimeagent

import (
	"context"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"google.golang.org/grpc/codes"
)

func (s *Service) authorizeMemoryEmbeddingTarget(accountID, localAgentRef string) error {
	accountID = strings.TrimSpace(accountID)
	localAgentRef = strings.TrimSpace(localAgentRef)
	if s == nil || accountID == "" || localAgentRef == "" {
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
		strings.TrimSpace(entry.Agent.GetOwnerUserId()) != accountID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.security-core.r064
func (s *Service) ResolveMemoryEmbeddingIntent(ctx context.Context, accountNamespace, localAgentRef string) (*cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot, error) {
	if err := s.authorizeMemoryEmbeddingTarget(accountNamespace, localAgentRef); err != nil {
		return nil, err
	}
	accountNamespace = strings.TrimSpace(accountNamespace)
	config, revisionText, found, err := s.readSharedLocalAgentAIConfig(ctx, accountNamespace)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
	}
	revision, err := strconv.ParseUint(revisionText, 10, 64)
	if err != nil || revision == 0 {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
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
	snapshot := &cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot{
		ConfigRevision: revision,
		RevisionToken:  aiconfig.Hash(config),
	}
	if embeddingIntent.GetLocal() != nil {
		if s.localExecution == nil {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
		}
		selected, err := s.localExecution.ResolveSelectedLocalExecution(capabilitydriver.TextEmbedCapabilityContract)
		if err != nil {
			return nil, err
		}
		if selected == nil || strings.TrimSpace(selected.LoadoutID) == "" ||
			selected.CapabilityContract != capabilitydriver.TextEmbedCapabilityContract {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
		}
		snapshot.SourceKind = cognitionmemory.MemoryEmbeddingTextEmbedSourceKindLocal
		snapshot.LocalBinding = &cognitionmemory.MemoryEmbeddingLocalBindingRef{
			LoadoutRef: selected.LoadoutID,
		}
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
	snapshot.SourceKind = cognitionmemory.MemoryEmbeddingTextEmbedSourceKindCloud
	snapshot.CloudBinding = &cognitionmemory.MemoryEmbeddingCloudBindingRef{
		ConnectorID:          cloud.ConnectorID,
		RemoteModelCatalogID: cloud.RemoteModelCatalogID,
		ProviderModelID:      cloud.ProviderModelID,
		Provider:             cloud.Provider,
	}
	return snapshot, nil
}
