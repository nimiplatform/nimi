package connector

import (
	"context"
	"errors"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func mapCatalogProviderSource(source aicatalog.ProviderSource) runtimev1.ModelCatalogProviderSource {
	switch source {
	case aicatalog.ProviderSourceOverridden:
		return runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_OVERRIDDEN
	case aicatalog.ProviderSourceCustom:
		return runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_CUSTOM
	default:
		return runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_BUILTIN
	}
}

func mapCatalogModelSource(source aicatalog.ModelSource) runtimev1.CatalogModelSource {
	switch source {
	case aicatalog.ModelSourceCustom:
		return runtimev1.CatalogModelSource_CATALOG_MODEL_SOURCE_CUSTOM
	case aicatalog.ModelSourceOverridden:
		return runtimev1.CatalogModelSource_CATALOG_MODEL_SOURCE_OVERRIDDEN
	default:
		return runtimev1.CatalogModelSource_CATALOG_MODEL_SOURCE_BUILTIN
	}
}

func modelCatalogProviderEntryFromRecord(record aicatalog.CatalogProviderRecord) *runtimev1.ModelCatalogProviderEntry {
	entry := ProviderCatalog[record.Provider]
	cap := ProviderCapabilities[record.Provider]
	return &runtimev1.ModelCatalogProviderEntry{
		Provider:                 record.Provider,
		Version:                  int32(record.Version),
		CatalogVersion:           record.CatalogVersion,
		Source:                   mapCatalogProviderSource(record.Source),
		ModelCount:               uint32(record.ModelCount),
		VoiceCount:               uint32(record.VoiceCount),
		Yaml:                     record.YAML,
		DefaultTextModel:         record.DefaultTextModel,
		Capabilities:             append([]string(nil), record.Capabilities...),
		HasOverlay:               record.HasOverlay,
		CustomModelCount:         uint32(record.CustomModelCount),
		OverriddenModelCount:     uint32(record.OverriddenModelCount),
		OverlayUpdatedAt:         record.OverlayUpdatedAt,
		EffectiveYaml:            record.EffectiveYAML,
		DefaultEndpoint:          entry.DefaultEndpoint,
		RequiresExplicitEndpoint: entry.RequiresExplicitEndpoint,
		RuntimePlane:             cap.RuntimePlane,
		ExecutionModule:          cap.ExecutionModule,
		ManagedSupported:         cap.ManagedSupported,
	}
}

func (s *Service) listAllActiveLocalModels(ctx context.Context) ([]*runtimev1.LocalAssetRecord, error) {
	localModel := s.localModelLister()
	if localModel == nil {
		return nil, nil
	}
	pageToken := ""
	collected := make([]*runtimev1.LocalAssetRecord, 0, 16)
	for i := 0; i < 20; i++ {
		resp, err := localModel.ListLocalAssets(ctx, &runtimev1.ListLocalAssetsRequest{
			StatusFilter: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			PageSize:     100,
			PageToken:    pageToken,
		})
		if err != nil {
			return nil, err
		}
		collected = append(collected, resp.GetAssets()...)
		pageToken = strings.TrimSpace(resp.GetNextPageToken())
		if pageToken == "" {
			break
		}
	}
	return collected, nil
}

func hasActiveLocalModelForCategory(models []*runtimev1.LocalAssetRecord, category runtimev1.LocalConnectorCategory) bool {
	for _, model := range models {
		if modelMatchesCategory(model, category) {
			return true
		}
	}
	return false
}

func buildLocalConnectorModelDescriptors(models []*runtimev1.LocalAssetRecord, category runtimev1.LocalConnectorCategory) []*runtimev1.ConnectorModelDescriptor {
	descriptors := make([]*runtimev1.ConnectorModelDescriptor, 0, len(models))
	for _, model := range models {
		if !modelMatchesCategory(model, category) {
			continue
		}
		descriptors = append(descriptors, &runtimev1.ConnectorModelDescriptor{
			ModelId:      model.GetAssetId(),
			ModelLabel:   model.GetAssetId(),
			Available:    model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Capabilities: append([]string(nil), model.GetCapabilities()...),
		})
	}
	return descriptors
}

func (s *Service) listCatalogConnectorModels(subjectUserID string, provider string) ([]*runtimev1.ConnectorModelDescriptor, error) {
	modelCatalog := s.modelCatalogResolver()
	if modelCatalog == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}

	models, _, err := modelCatalog.ListModelsForProviderForSubject(subjectUserID, provider)
	if err != nil {
		if errors.Is(err, aicatalog.ErrProviderUnsupported) {
			return []*runtimev1.ConnectorModelDescriptor{}, nil
		}
		return nil, s.internalProviderError("list_connector_models.catalog_models", err)
	}

	descriptors := make([]*runtimev1.ConnectorModelDescriptor, 0, len(models))
	for _, model := range models {
		descriptors = append(descriptors, &runtimev1.ConnectorModelDescriptor{
			ModelId:      model.Model.ModelID,
			ModelLabel:   model.Model.ModelID,
			Available:    true,
			Capabilities: append([]string(nil), model.Model.Capabilities...),
		})
	}
	return descriptors, nil
}

func modelMatchesCategory(model *runtimev1.LocalAssetRecord, category runtimev1.LocalConnectorCategory) bool {
	caps := make(map[string]bool, len(model.GetCapabilities()))
	for _, capability := range model.GetCapabilities() {
		capLower := strings.ToLower(strings.TrimSpace(capability))
		if capLower != "" {
			caps[capLower] = true
		}
	}
	hasAny := func(keys ...string) bool {
		for _, key := range keys {
			if caps[strings.ToLower(strings.TrimSpace(key))] {
				return true
			}
		}
		return false
	}

	switch category {
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_LLM:
		return hasAny("chat", "llm", "text", "text.generate")
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_VISION:
		return hasAny("vision", "vl", "multimodal", "image.understand", "audio_chat", "video_chat", "text.generate.vision", "text.generate.audio", "text.generate.video")
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_IMAGE:
		return hasAny("image", "image.generate")
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_TTS:
		return hasAny("tts", "speech.synthesize", "audio.synthesize")
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_STT:
		return hasAny("stt", "speech.transcribe", "audio.transcribe")
	case runtimev1.LocalConnectorCategory_LOCAL_CONNECTOR_CATEGORY_CUSTOM:
		return strings.TrimSpace(model.GetLocalInvokeProfileId()) != "" || hasAny("custom")
	default:
		return true
	}
}
