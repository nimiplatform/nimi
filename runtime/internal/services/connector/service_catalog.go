package connector

import (
	"context"
	"errors"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/services/ai/catalog"
)

func mapCatalogProviderSource(source aicatalog.ProviderSource) runtimev1.ModelCatalogProviderSource {
	switch source {
	case aicatalog.ProviderSourceCustom:
		return runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_CUSTOM
	default:
		return runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_BUILTIN
	}
}

func (s *Service) listAllActiveLocalModels(ctx context.Context) ([]*runtimev1.LocalModelRecord, error) {
	if s.localModel == nil {
		return nil, nil
	}
	pageToken := ""
	collected := make([]*runtimev1.LocalModelRecord, 0, 16)
	for i := 0; i < 20; i++ {
		resp, err := s.localModel.ListLocalModels(ctx, &runtimev1.ListLocalModelsRequest{
			StatusFilter: runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			PageSize:     100,
			PageToken:    pageToken,
		})
		if err != nil {
			return nil, err
		}
		collected = append(collected, resp.GetModels()...)
		pageToken = strings.TrimSpace(resp.GetNextPageToken())
		if pageToken == "" {
			break
		}
	}
	return collected, nil
}

func hasActiveLocalModelForCategory(models []*runtimev1.LocalModelRecord, category runtimev1.LocalConnectorCategory) bool {
	for _, model := range models {
		if modelMatchesCategory(model, category) {
			return true
		}
	}
	return false
}

func buildLocalConnectorModelDescriptors(models []*runtimev1.LocalModelRecord, category runtimev1.LocalConnectorCategory) []*runtimev1.ConnectorModelDescriptor {
	descriptors := make([]*runtimev1.ConnectorModelDescriptor, 0, len(models))
	for _, model := range models {
		if !modelMatchesCategory(model, category) {
			continue
		}
		descriptors = append(descriptors, &runtimev1.ConnectorModelDescriptor{
			ModelId:      model.GetModelId(),
			ModelLabel:   model.GetModelId(),
			Available:    model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			Capabilities: append([]string(nil), model.GetCapabilities()...),
		})
	}
	return descriptors
}

func (s *Service) listCatalogConnectorModels(provider string) ([]*runtimev1.ConnectorModelDescriptor, error) {
	if s.modelCatalog == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}

	models, _, err := s.modelCatalog.ListModelsForProvider(provider)
	if err != nil {
		if errors.Is(err, aicatalog.ErrProviderUnsupported) {
			return []*runtimev1.ConnectorModelDescriptor{}, nil
		}
		return nil, s.internalProviderError("list_connector_models.catalog_models", err)
	}

	descriptors := make([]*runtimev1.ConnectorModelDescriptor, 0, len(models))
	for _, model := range models {
		descriptors = append(descriptors, &runtimev1.ConnectorModelDescriptor{
			ModelId:      model.ModelID,
			ModelLabel:   model.ModelID,
			Available:    true,
			Capabilities: append([]string(nil), model.Capabilities...),
		})
	}
	return descriptors, nil
}

func modelMatchesCategory(model *runtimev1.LocalModelRecord, category runtimev1.LocalConnectorCategory) bool {
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
		return hasAny("vision", "vl", "multimodal", "image.understand")
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
