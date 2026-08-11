package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func (s *Service) EmbedTextsForMemory(ctx context.Context, profile *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
	if s == nil || profile == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	trimmedInputs := make([]string, 0, len(inputs))
	for _, input := range inputs {
		trimmedInputs = append(trimmedInputs, strings.TrimSpace(input))
	}
	var (
		vectors []*runtimev1.EmbeddingVector
		err     error
	)
	if strings.TrimSpace(profile.GetProvider()) == "local" {
		vectors, err = s.embedMemoryTextsLocal(ctx, profile, trimmedInputs)
	} else {
		vectors, err = s.embedMemoryTextsRemote(ctx, profile, trimmedInputs)
	}
	if err != nil {
		return nil, err
	}
	// K-MEM-004 / K-AIEXEC-006: the resolved profile dimension is catalog
	// authority. The observed embedding vector length is used ONLY for runtime
	// validation + drift evidence: on mismatch we fail-close with a typed
	// AI_OUTPUT_INVALID reason. We never mutate the resolved profile to match an
	// observed length, and never emit a vector whose width contradicts the bound
	// bank identity.
	expectedDimension := int(profile.GetDimension())
	out := make([][]float64, 0, len(vectors))
	for _, vector := range vectors {
		values := vector.GetValues()
		if expectedDimension > 0 && len(values) != expectedDimension {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		out = append(out, append([]float64(nil), values...))
	}
	return out, nil
}

func (s *Service) embedMemoryTextsLocal(ctx context.Context, profile *runtimev1.MemoryEmbeddingProfile, inputs []string) ([]*runtimev1.EmbeddingVector, error) {
	localAssetID := strings.TrimSpace(profile.GetVersion())
	if localAssetID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEMORY_EMBEDDING_TARGET_REF_INVALID)
	}
	effective, err := s.captureSelectedLocalEmbedEffectiveInputs(&runtimev1.TextEmbedScenarioSpec{
		Inputs: append([]string(nil), inputs...),
	}, nil, localAssetID)
	if err != nil {
		return nil, err
	}
	result, err := s.executeCapturedLocalEmbed(ctx, effective)
	if err != nil {
		return nil, err
	}
	return result.Vectors, nil
}

func (s *Service) embedMemoryTextsRemote(ctx context.Context, profile *runtimev1.MemoryEmbeddingProfile, inputs []string) ([]*runtimev1.EmbeddingVector, error) {
	if s.cloudProvider == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	cloudBinding := profile.GetCloudBinding()
	if cloudBinding == nil ||
		strings.TrimSpace(cloudBinding.GetConnectorId()) == "" ||
		strings.TrimSpace(cloudBinding.GetRemoteModelCatalogId()) == "" ||
		strings.TrimSpace(cloudBinding.GetProviderModelId()) == "" ||
		strings.TrimSpace(cloudBinding.GetProvider()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEMORY_EMBEDDING_TARGET_REF_INVALID)
	}
	connectorID := strings.TrimSpace(cloudBinding.GetConnectorId())
	target, err := resolveManagedTarget(ctx, connectorID, s.connStore, s.allowLoopback)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(strings.TrimSpace(target.ProviderType), strings.TrimSpace(cloudBinding.GetProvider())) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE)
	}
	applyMemoryEmbeddingCloudBinding(target, cloudBinding)
	rawVectors, _, err := s.cloudProvider.EmbedWithTarget(ctx, strings.TrimSpace(cloudBinding.GetProviderModelId()), inputs, target)
	if err != nil {
		return nil, err
	}
	return embeddingVectorsFromListValues(rawVectors), nil
}

func applyMemoryEmbeddingCloudBinding(target *nimillm.RemoteTarget, binding *runtimev1.MemoryEmbeddingCloudBindingRef) {
	if target == nil || binding == nil {
		return
	}
	target.ConnectorID = strings.TrimSpace(binding.GetConnectorId())
	target.RemoteModelCatalogID = strings.TrimSpace(binding.GetRemoteModelCatalogId())
	target.ProviderModelID = strings.TrimSpace(binding.GetProviderModelId())
	if provider := strings.TrimSpace(binding.GetProvider()); provider != "" {
		target.ProviderType = provider
	}
}

func embeddingVectorsFromListValues(values []*structpb.ListValue) []*runtimev1.EmbeddingVector {
	out := make([]*runtimev1.EmbeddingVector, 0, len(values))
	for _, vector := range values {
		item := &runtimev1.EmbeddingVector{Values: make([]float64, 0, len(vector.GetValues()))}
		for _, value := range vector.GetValues() {
			item.Values = append(item.Values, value.GetNumberValue())
		}
		out = append(out, item)
	}
	return out
}
