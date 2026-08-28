package grpcserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
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
	"google.golang.org/protobuf/proto"
)

const cognitionMemoryEmbeddingSpaceIdentityDomain = "nimi.cognition.memory-embedding-space/v1\x00"

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
		snapshot.EmbeddingSpaceRef = resolved.EmbeddingSpaceRef
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
				return executeCognitionMemoryEmbedding(jobCtx, accountID, aiSvc, profile, inputs)
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
	spaceRef, err := cognitionMemoryEmbeddingSpaceIdentity(intent, resolved.Profile)
	if err != nil {
		return cognitionmemory.ResolvedEmbeddingBinding{}
	}
	return cognitionmemory.ResolvedEmbeddingBinding{ConfigRevision: intent.ConfigRevision, EmbeddingSpaceRef: spaceRef, Profile: resolved.Profile}
}

func cognitionMemoryEmbeddingSpaceIdentity(intent *cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot, profile *runtimev1.MemoryEmbeddingProfile) (string, error) {
	if intent == nil || profile == nil {
		return "", fmt.Errorf("Cognition Memory embedding space identity is unavailable")
	}
	profileRaw, err := proto.MarshalOptions{Deterministic: true}.Marshal(profile)
	if err != nil {
		return "", fmt.Errorf("encode Cognition Memory embedding profile identity: %w", err)
	}
	var binding string
	switch intent.SourceKind {
	case cognitionmemory.MemoryEmbeddingTextEmbedSourceKindLocal:
		if intent.LocalBinding != nil {
			binding = strings.TrimSpace(intent.LocalBinding.LoadoutRef)
		}
	case cognitionmemory.MemoryEmbeddingTextEmbedSourceKindCloud:
		if intent.CloudBinding != nil {
			binding = strings.Join([]string{
				strings.TrimSpace(intent.CloudBinding.ConnectorID),
				strings.TrimSpace(intent.CloudBinding.RemoteModelCatalogID),
				strings.TrimSpace(intent.CloudBinding.ProviderModelID),
				strings.TrimSpace(intent.CloudBinding.Provider),
			}, "\x00")
		}
	}
	if binding == "" {
		return "", fmt.Errorf("Cognition Memory embedding binding identity is unavailable")
	}
	payload := make([]byte, 0, len(cognitionMemoryEmbeddingSpaceIdentityDomain)+len(binding)+len(profileRaw)+2)
	payload = append(payload, cognitionMemoryEmbeddingSpaceIdentityDomain...)
	payload = append(payload, string(intent.SourceKind)...)
	payload = append(payload, 0)
	payload = append(payload, binding...)
	payload = append(payload, 0)
	payload = append(payload, profileRaw...)
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:]), nil
}

func executeCognitionMemoryEmbedding(ctx context.Context, accountID string, aiSvc *aiservice.Service, profile *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
	if aiSvc == nil || profile == nil || len(inputs) == 0 || accountID == "" {
		return nil, fmt.Errorf("Cognition Memory embedding execution is unavailable")
	}
	ctx = cognitionMemoryEmbeddingExecutionContext(ctx, accountID)
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

func cognitionMemoryEmbeddingExecutionContext(ctx context.Context, accountID string) context.Context {
	ctx = withRuntimeMemoryEmbeddingSubject(ctx, accountID)
	return executionintent.WithRuntimeAccountSubject(ctx, accountID)
}
