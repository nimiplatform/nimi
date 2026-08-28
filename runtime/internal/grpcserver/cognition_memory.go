package grpcserver

import (
	"context"
	"fmt"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
)

func newCognitionMemoryCapabilityProvider(
	backend *runtimepersistence.Backend,
	agentSvc *runtimeagentservice.Service,
	aiSvc *aiservice.Service,
	connStore *connectorservice.ConnectorStore,
	modelCatalog *catalog.Resolver,
	localResolver localexecution.Resolver,
) cognitionmemory.CapabilityProvider {
	return func(ctx context.Context, binding cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		snapshot := memoryv1.CapabilitySnapshot{Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}
		accountID, intent, err := agentSvc.ResolveCognitionMemoryEmbeddingIntent(ctx, binding.LocalAgentRef)
		if err != nil || intent == nil || intent.ConfigRevision == 0 {
			return snapshot, nil, nil
		}
		resolved := resolveCognitionMemoryEmbeddingBinding(ctx, accountID, intent, connStore, modelCatalog, localResolver)
		if resolved.Profile == nil {
			return snapshot, nil, nil
		}
		snapshot.ConfigRevision = resolved.ConfigRevision
		snapshot.Available = append(snapshot.Available, memoryv1.CapabilityTextEmbed, memoryv1.CapabilityVectorIndex)
		port := cognitionmemory.NewRuntimeEmbeddingPort(
			backend,
			accountID,
			binding.LocalAgentRef,
			func(jobCtx context.Context, _, localAgentRef string) (cognitionmemory.ResolvedEmbeddingBinding, error) {
				currentAccountID, currentIntent, err := agentSvc.ResolveCognitionMemoryEmbeddingIntent(jobCtx, localAgentRef)
				if err != nil {
					return cognitionmemory.ResolvedEmbeddingBinding{}, err
				}
				return resolveCognitionMemoryEmbeddingBinding(jobCtx, currentAccountID, currentIntent, connStore, modelCatalog, localResolver), nil
			},
			func(jobCtx context.Context, profile *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
				return executeCognitionMemoryEmbedding(jobCtx, aiSvc, profile, inputs)
			},
		)
		return snapshot, port, nil
	}
}

func resolveCognitionMemoryEmbeddingBinding(ctx context.Context, accountID string, intent *cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot, connStore *connectorservice.ConnectorStore, modelCatalog *catalog.Resolver, localResolver localexecution.Resolver) cognitionmemory.ResolvedEmbeddingBinding {
	ctx = withRuntimeMemoryEmbeddingSubject(ctx, accountID)
	ctx = executionintent.WithRuntimeAccountSubject(ctx, accountID)
	resolved := resolveRuntimeMemoryEmbeddingProfile(ctx, intent, connStore, modelCatalog, localResolver)
	if resolved.ResolutionState != "resolved" || resolved.Profile == nil {
		return cognitionmemory.ResolvedEmbeddingBinding{}
	}
	return cognitionmemory.ResolvedEmbeddingBinding{ConfigRevision: intent.ConfigRevision, Profile: resolved.Profile}
}

func executeCognitionMemoryEmbedding(ctx context.Context, aiSvc *aiservice.Service, profile *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
	if aiSvc == nil || profile == nil || len(inputs) == 0 {
		return nil, fmt.Errorf("Cognition Memory embedding execution is unavailable")
	}
	vectors := make([][]float64, 0, len(inputs))
	for offset := 0; offset < len(inputs); offset += sourceCognitionEmbeddingBatchSize {
		end := min(offset+sourceCognitionEmbeddingBatchSize, len(inputs))
		batchCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		batch, err := aiSvc.EmbedTextsForMemory(batchCtx, profile, append([]string(nil), inputs[offset:end]...))
		batchErr := batchCtx.Err()
		cancel()
		if err != nil {
			return nil, err
		}
		if batchErr != nil {
			return nil, batchErr
		}
		vectors = append(vectors, batch...)
	}
	return vectors, nil
}
