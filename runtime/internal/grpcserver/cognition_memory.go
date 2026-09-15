package grpcserver

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
)

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r022
func newCognitionMemoryCapabilityProvider(backend *runtimepersistence.Backend, agentSvc *runtimeagentservice.Service, aiSvc *aiservice.Service, store *cognitionmemory.Store) cognitionmemory.CapabilityProvider {
	return func(ctx context.Context, binding cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		snapshot := memoryv1.CapabilitySnapshot{Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}
		if err := agentSvc.AuthorizeCognitionMemoryBinding(ctx, binding); err != nil {
			return snapshot, nil, err
		}
		accountID, err := agentSvc.CognitionMemoryAccount(binding.LocalAgentRef)
		if err != nil {
			return snapshot, nil, err
		}
		ctx = cognitionMemoryEmbeddingExecutionContext(ctx, accountID)
		port := cognitionmemory.NewRuntimeEmbeddingPort(backend, accountID, binding.LocalAgentRef,
			func(jobCtx context.Context, account, agent string, request memoryv1.AIEmbeddingRequest) (cognitionmemory.ResolvedEmbeddingBinding, error) {
				if account != accountID || agent != binding.LocalAgentRef || request.BankRef != binding.BankRef || request.LifecycleRef != binding.LifecycleRef {
					return cognitionmemory.ResolvedEmbeddingBinding{}, fmt.Errorf("Memory embedding owner mismatch")
				}
				if err := agentSvc.AuthorizeCognitionMemoryBinding(jobCtx, binding); err != nil {
					return cognitionmemory.ResolvedEmbeddingBinding{}, err
				}
				jobCtx = cognitionMemoryEmbeddingExecutionContext(jobCtx, accountID)
				captured, raw, err := aiSvc.CaptureMemoryEmbedding(jobCtx, request.Inputs, request.EmbeddingSpaceRef, aiservice.EmbeddingOwner{Kind: "memory", AgentRef: agent, OperationID: request.OperationID, BankRef: request.BankRef, LifecycleRef: request.LifecycleRef, MemoryRefs: request.MemoryRefs})
				return cognitionmemory.ResolvedEmbeddingBinding{ConfigRevision: captured.ConfigRevision, EmbeddingSpaceRef: captured.SpaceID, Execution: raw,
					Validate: func(tx *sql.Tx) error { return cognitionmemory.ValidateEmbeddingCaptureTx(tx, binding, request) },
					Discard:  func() error { return aiSvc.DiscardMemoryEmbedding(context.WithoutCancel(jobCtx), raw) }}, err
			},
			func(jobCtx context.Context, raw []byte) (memoryv1.AIEmbeddingResult, error) {
				jobCtx = cognitionMemoryEmbeddingExecutionContext(jobCtx, accountID)
				// The Memory port disposes its captured payload when this executor fails.
				if err := agentSvc.AuthorizeCognitionMemoryBinding(jobCtx, binding); err != nil {
					return memoryv1.AIEmbeddingResult{}, err
				}
				result, err := aiSvc.ExecuteMemoryEmbedding(cognitionMemoryEmbeddingExecutionContext(jobCtx, accountID), raw)
				return memoryv1.AIEmbeddingResult{Vectors: result.Vectors, Dimension: result.Dimension, SpaceID: result.SpaceID}, err
			}, cognitionMemoryPayloadDisposer(aiSvc))
		port.SetCaptureGuard(store.EmbeddingCaptureMutex(binding.LocalAgentRef), func(ctx context.Context, request memoryv1.AIEmbeddingRequest) error {
			return store.ValidateEmbeddingCapture(ctx, binding, request)
		})
		description, err := aiSvc.DescribeMemoryEmbedding(ctx)
		if err != nil {
			return snapshot, port, nil
		}
		snapshot.ConfigRevision = description.ConfigRevision
		snapshot.EmbeddingSpaceRef = description.SpaceID
		snapshot.Available = append(snapshot.Available, memoryv1.CapabilityTextEmbed, memoryv1.CapabilityVectorIndex)
		return snapshot, port, nil
	}
}

func cognitionMemoryEmbeddingExecutionContext(ctx context.Context, accountID string) context.Context {
	return executionintent.WithRuntimeAccountSubject(ctx, accountID)
}

func cognitionMemoryPayloadDisposer(aiSvc *aiservice.Service) cognitionmemory.EmbeddingDisposer {
	return func(ctx context.Context, account, agent string, raw []byte) error {
		return aiSvc.DisposeMemoryEmbeddingForOwner(cognitionMemoryEmbeddingExecutionContext(ctx, account), agent, raw)
	}
}
