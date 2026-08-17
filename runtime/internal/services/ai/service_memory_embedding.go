package ai

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) EmbedTextsForMemory(ctx context.Context, profile *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
	if s == nil || profile == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	trimmedInputs := make([]string, 0, len(inputs))
	for _, input := range inputs {
		trimmedInputs = append(trimmedInputs, strings.TrimSpace(input))
	}
	intentCtx, head, intent, err := s.captureMemoryEmbeddingIntent(ctx)
	if err != nil {
		return nil, err
	}
	var (
		vectors []*runtimev1.EmbeddingVector
	)
	if intent.IsLocal() {
		vectors, err = s.embedMemoryTextsLocal(intentCtx, head, profile, trimmedInputs, intent)
	} else if intent.IsCloud() {
		vectors, err = s.embedMemoryTextsRemote(intentCtx, head, profile, trimmedInputs)
	} else {
		return nil, missingAIConfigRouteError()
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

func (s *Service) captureMemoryEmbeddingIntent(ctx context.Context) (context.Context, *runtimev1.ScenarioRequestHead, executionintent.Intent, error) {
	if s == nil || s.aiConfigStore == nil {
		return ctx, nil, executionintent.Intent{}, appAIConfigPersistenceError(fmt.Errorf("AIConfig store is unavailable"))
	}
	accountID := scenarioTargetSubjectUserID(ctx, nil)
	if accountID == "" {
		return ctx, nil, executionintent.Intent{}, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	config, found, err := s.aiConfigStore.Get(ctx, accountID, aiconfig.LocalAgentSubsystemOwner())
	if err != nil {
		return ctx, nil, executionintent.Intent{}, appAIConfigPersistenceError(err)
	}
	if !found || config == nil {
		return ctx, nil, executionintent.Intent{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
	}
	for _, capability := range config.GetCapabilities() {
		if capability.GetCapabilityContract() != capabilitydriver.TextEmbedCapabilityContract {
			continue
		}
		intent, intentErr := executionintent.FromCapability(capability)
		if intentErr != nil {
			return ctx, nil, executionintent.Intent{}, grpcerr.WrapWithReasonCode(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AI_CONFIG_INVALID,
				intentErr,
				grpcerr.ReasonOptions{Message: "shared LocalAgent text.embed AIConfig is incomplete"},
			)
		}
		head := &runtimev1.ScenarioRequestHead{AppId: "nimi.runtime.memory", SubjectUserId: accountID}
		return executionintent.WithIntent(ctx, intent), head, intent, nil
	}
	return ctx, nil, executionintent.Intent{}, grpcerr.WithReasonCodeOptions(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_CONFIG_INVALID,
		grpcerr.ReasonOptions{Message: "shared LocalAgent text.embed AIConfig is missing"},
	)
}

func (s *Service) embedMemoryTextsLocal(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	profile *runtimev1.MemoryEmbeddingProfile,
	inputs []string,
	intent executionintent.Intent,
) ([]*runtimev1.EmbeddingVector, error) {
	if strings.TrimSpace(profile.GetProvider()) != "local" || !intent.IsLocal() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEMORY_EMBEDDING_TARGET_REF_INVALID)
	}
	modelAssetID := strings.TrimSpace(profile.GetVersion())
	if modelAssetID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEMORY_EMBEDDING_TARGET_REF_INVALID)
	}
	effective, err := s.captureSelectedLocalEmbedEffectiveInputs(&runtimev1.TextEmbedScenarioSpec{
		Inputs: append([]string(nil), inputs...),
	}, intent.RequiredFeatures, modelAssetID)
	if err != nil {
		return nil, err
	}
	result, _, _, err := s.executeCapturedLocalEmbedJob(ctx, head, effective, nil)
	if err != nil {
		return nil, err
	}
	return result.Vectors, nil
}

func (s *Service) embedMemoryTextsRemote(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	profile *runtimev1.MemoryEmbeddingProfile,
	inputs []string,
) ([]*runtimev1.EmbeddingVector, error) {
	cloudBinding := profile.GetCloudBinding()
	if cloudBinding == nil ||
		strings.TrimSpace(cloudBinding.GetConnectorId()) == "" ||
		strings.TrimSpace(cloudBinding.GetRemoteModelCatalogId()) == "" ||
		strings.TrimSpace(cloudBinding.GetProviderModelId()) == "" ||
		strings.TrimSpace(cloudBinding.GetProvider()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEMORY_EMBEDDING_TARGET_REF_INVALID)
	}
	request := &runtimev1.ExecuteScenarioRequest{
		Head:          head,
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{
			Inputs: append([]string(nil), inputs...),
		}}},
	}
	effective, err := s.captureCloudEmbedEffectiveInputs(ctx, head, request)
	if err != nil {
		return nil, err
	}
	defer effective.release()
	if strings.TrimSpace(profile.GetProvider()) != effective.target.Provider() ||
		strings.TrimSpace(profile.GetModelId()) != effective.target.ProviderModelID() ||
		strings.TrimSpace(profile.GetVersion()) != effective.connector.ConnectorID ||
		strings.TrimSpace(cloudBinding.GetProvider()) != effective.target.Provider() ||
		strings.TrimSpace(cloudBinding.GetProviderModelId()) != effective.target.ProviderModelID() ||
		strings.TrimSpace(cloudBinding.GetRemoteModelCatalogId()) != effective.target.RemoteModelCatalogID() ||
		strings.TrimSpace(cloudBinding.GetConnectorId()) != effective.connector.ConnectorID {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE)
	}
	result, _, err := s.executeCapturedCloudEmbedJob(ctx, head, effective, nil)
	if err != nil {
		return nil, err
	}
	return result.Vectors, nil
}
