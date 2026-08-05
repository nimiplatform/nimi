package ai

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
)

// validateConnectorTTSModelSupport is catalog-only request admission. It never
// probes a provider and therefore cannot turn credential/network state into
// configuration or routing truth.
func validateConnectorTTSModelSupport(
	ctx context.Context,
	logger *slog.Logger,
	req *runtimev1.SubmitScenarioJobRequest,
	effectiveSpec *runtimev1.SpeechSynthesizeScenarioSpec,
	resolvedModelID string,
	remoteTarget *nimillm.RemoteTarget,
	_ *nimillm.CloudProvider,
	voiceCatalog *catalog.Resolver,
) error {
	if req == nil || req.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		return nil
	}
	if remoteTarget == nil {
		return nil
	}

	requestedSpec := req.GetSpec().GetSpeechSynthesize()
	if effectiveSpec == nil {
		effectiveSpec = requestedSpec
	}
	matchedModelID := strings.TrimSpace(resolvedModelID)
	if matchedModelID == "" || voiceCatalog == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if _, err := voiceCatalog.ResolveModelEntryForSubject(
		catalogSubjectUserIDFromContext(ctx),
		strings.TrimSpace(remoteTarget.ProviderType),
		matchedModelID,
	); err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			return grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, err, grpcerr.ReasonOptions{
				Message: "model not found in provider voice catalog",
			})
		}
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "provider voice catalog could not be read",
		})
	}

	switch requestedKind := requestedVoiceReferenceKind(requestedSpec); requestedKind {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_UNSPECIFIED:
		return nil
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		requestedVoice := resolveScenarioVoiceRef(requestedSpec)
		voices, source, catalogVersion, err := resolveCatalogVoicesForSubject(
			ctx,
			matchedModelID,
			strings.TrimSpace(remoteTarget.ProviderType),
			voiceCatalog,
		)
		if err != nil {
			return err
		}
		if catalogVersion == "" {
			catalogVersion = "n/a"
		}
		if logger != nil {
			logger.Debug(
				"voice-list-resolved",
				"source", string(source),
				"catalog_version", catalogVersion,
				"model_resolved", matchedModelID,
				"provider_type", strings.TrimSpace(remoteTarget.ProviderType),
				"connector_id", strings.TrimSpace(remoteTarget.ConnectorID),
			)
		}
		if !isSpeechVoiceSupported(requestedVoice, voices) {
			providerMessage := fmt.Sprintf("voice %q is not supported by model %q", requestedVoice, matchedModelID)
			return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH, grpcerr.ReasonOptions{
				ActionHint: "adjust_tts_voice_or_audio_options",
				Message:    providerMessage,
				Metadata: map[string]string{
					"provider_message":     providerMessage,
					"voice_catalog_source": string(source),
					"catalog_version":      catalogVersion,
					"requested_voice":      requestedVoice,
				},
			})
		}
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET:
		if strings.TrimSpace(resolveScenarioVoiceRef(requestedSpec)) == "" || strings.TrimSpace(resolveScenarioVoiceRef(effectiveSpec)) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if err := validateConnectorTTSVoiceRefKindSupport(ctx, strings.TrimSpace(remoteTarget.ProviderType), matchedModelID, requestedKind, voiceCatalog); err != nil {
			return err
		}
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		if strings.TrimSpace(resolveScenarioVoiceRef(effectiveSpec)) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if err := validateConnectorTTSVoiceRefKindSupport(ctx, strings.TrimSpace(remoteTarget.ProviderType), matchedModelID, requestedKind, voiceCatalog); err != nil {
			return err
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	return nil
}

func requestedVoiceReferenceKind(spec *runtimev1.SpeechSynthesizeScenarioSpec) runtimev1.VoiceReferenceKind {
	if spec == nil || spec.GetVoiceRef() == nil {
		return runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_UNSPECIFIED
	}
	return spec.GetVoiceRef().GetKind()
}

func validateConnectorTTSVoiceRefKindSupport(
	ctx context.Context,
	providerType string,
	modelID string,
	kind runtimev1.VoiceReferenceKind,
	voiceCatalog *catalog.Resolver,
) error {
	catalogKind := catalogVoiceReferenceKind(kind)
	if catalogKind == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if voiceCatalog == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	model, err := voiceCatalog.ResolveModelEntryForSubject(catalogSubjectUserIDFromContext(ctx), providerType, modelID)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			providerMessage := "model not found in provider voice catalog"
			return grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, err, grpcerr.ReasonOptions{
				ActionHint: "switch_tts_model_or_refresh_connector_models",
				Message:    providerMessage,
				Metadata: map[string]string{
					"provider_message": providerMessage,
					"provider_type":    strings.ToLower(strings.TrimSpace(providerType)),
				},
			})
		}
		return err
	}
	for _, supported := range model.VoiceRefKinds {
		if strings.EqualFold(strings.TrimSpace(supported), catalogKind) {
			return nil
		}
	}
	providerMessage := fmt.Sprintf("voice reference kind %q is not supported by model %q", catalogKind, strings.TrimSpace(model.ModelID))
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
		ActionHint: "select_model_supporting_custom_voice_reference",
		Message:    providerMessage,
		Metadata: map[string]string{
			"provider_message": providerMessage,
			"provider_type":    strings.ToLower(strings.TrimSpace(providerType)),
			"model_id":         strings.TrimSpace(model.ModelID),
			"voice_ref_kind":   catalogKind,
		},
	})
}

func catalogVoiceReferenceKind(kind runtimev1.VoiceReferenceKind) string {
	switch kind {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		return "preset_voice_id"
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET:
		return "voice_asset_id"
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		return "provider_voice_ref"
	default:
		return ""
	}
}
