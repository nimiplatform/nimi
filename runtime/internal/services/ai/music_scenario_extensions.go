package ai

import (
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"google.golang.org/grpc/codes"
)

func resolveMusicGenerateExtensionPayload(req *runtimev1.SubmitScenarioJobRequest) (map[string]any, *nimillm.MusicIterationExtension, error) {
	if req == nil || req.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE {
		return nil, nil, nil
	}
	for _, ext := range req.GetExtensions() {
		if strings.TrimSpace(ext.GetNamespace()) != "nimi.scenario.music_generate.request" {
			continue
		}
		return nimillm.NormalizeMusicIterationExtension(nimillm.StructToMap(ext.GetPayload()))
	}
	return nil, nil, nil
}

func validateMusicGenerateIterationSupport(
	s *Service,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	iteration *nimillm.MusicIterationExtension,
) error {
	if iteration == nil {
		return nil
	}
	providerType := inferScenarioProviderType(modelResolved, remoteTarget, selected)
	if providerType == "" || !providerregistry.Contains(providerType) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if s == nil || s.speechCatalog == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	supported, err := s.speechCatalog.SupportsCapability(providerType, modelResolved, aicapabilities.MusicGenerateIteration)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
		}
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if !supported || !nimillm.SupportsMusicGenerationIterationStrategy(providerType) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil
}
