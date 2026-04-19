package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
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
	out := make([][]float64, 0, len(vectors))
	for _, vector := range vectors {
		out = append(out, append([]float64(nil), vector.GetValues()...))
	}
	return out, nil
}

func (s *Service) embedMemoryTextsLocal(ctx context.Context, profile *runtimev1.MemoryEmbeddingProfile, inputs []string) ([]*runtimev1.EmbeddingVector, error) {
	selected, ok := s.selector.local.(*localProvider)
	if !ok || selected == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	rawVectors, _, err := selected.Embed(ctx, strings.TrimSpace(profile.GetModelId()), inputs)
	if err != nil {
		return nil, err
	}
	return embeddingVectorsFromListValues(rawVectors), nil
}

func (s *Service) embedMemoryTextsRemote(ctx context.Context, profile *runtimev1.MemoryEmbeddingProfile, inputs []string) ([]*runtimev1.EmbeddingVector, error) {
	if s.selector == nil || s.selector.cloudProvider == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	connectorID := strings.TrimSpace(profile.GetVersion())
	target, err := resolveManagedTarget(ctx, connectorID, s.connStore, s.allowLoopback)
	if err != nil {
		return nil, err
	}
	rawVectors, _, err := s.selector.cloudProvider.EmbedWithTarget(ctx, strings.TrimSpace(profile.GetModelId()), inputs, target)
	if err != nil {
		return nil, err
	}
	return embeddingVectorsFromListValues(rawVectors), nil
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
