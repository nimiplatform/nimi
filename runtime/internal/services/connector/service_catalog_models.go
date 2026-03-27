package connector

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
)

func (s *Service) ListCatalogProviderModels(ctx context.Context, req *runtimev1.ListCatalogProviderModelsRequest) (*runtimev1.ListCatalogProviderModelsResponse, error) {
	modelCatalog := s.modelCatalogResolver()
	if modelCatalog == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}
	provider := strings.TrimSpace(req.GetProvider())
	if provider == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	subjectUserID, _ := subjectUserIDFromContext(ctx)
	record, ok := lookupCatalogProviderRecord(modelCatalog.ListProvidersForSubject(subjectUserID), provider)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
	}
	models, _, err := modelCatalog.ListModelsForProviderForSubject(subjectUserID, provider)
	if err != nil {
		if errors.Is(err, aicatalog.ErrProviderUnsupported) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
		}
		return nil, s.internalProviderError("list_catalog_provider_models", err)
	}

	filterDigest := pagination.FilterDigest(provider)
	cursor, err := pagination.ValidatePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}
	startIdx := 0
	if cursor != "" {
		if idx, convErr := strconv.Atoi(cursor); convErr == nil && idx >= 0 && idx <= len(models) {
			startIdx = idx
		} else {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
		}
	}
	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 100
	} else if pageSize > 500 {
		pageSize = 500
	}
	endIdx := startIdx + pageSize
	if endIdx > len(models) {
		endIdx = len(models)
	}
	nextToken := ""
	if endIdx < len(models) {
		nextToken = pagination.Encode(strconv.Itoa(endIdx), filterDigest)
	}

	items := make([]*runtimev1.CatalogModelSummary, 0, endIdx-startIdx)
	for _, model := range models[startIdx:endIdx] {
		items = append(items, mapCatalogModelSummary(model))
	}

	return &runtimev1.ListCatalogProviderModelsResponse{
		Provider:      modelCatalogProviderEntryFromRecord(record),
		Models:        items,
		NextPageToken: nextToken,
		Warnings:      mapCatalogWarnings(providerWarnings(record)),
	}, nil
}

func (s *Service) GetCatalogModelDetail(ctx context.Context, req *runtimev1.GetCatalogModelDetailRequest) (*runtimev1.GetCatalogModelDetailResponse, error) {
	modelCatalog := s.modelCatalogResolver()
	if modelCatalog == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}
	provider := strings.TrimSpace(req.GetProvider())
	modelID := strings.TrimSpace(req.GetModelId())
	if provider == "" || modelID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	subjectUserID, _ := subjectUserIDFromContext(ctx)
	detail, record, _, err := modelCatalog.GetModelDetailForSubject(subjectUserID, provider, modelID)
	if err != nil {
		if errors.Is(err, aicatalog.ErrModelNotFound) || errors.Is(err, aicatalog.ErrProviderUnsupported) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
		}
		return nil, s.internalProviderError("get_catalog_model_detail", err)
	}
	return &runtimev1.GetCatalogModelDetailResponse{
		Provider: modelCatalogProviderEntryFromRecord(record),
		Model:    mapCatalogModelDetail(detail),
		Warnings: mapCatalogWarnings(providerWarnings(record)),
	}, nil
}

func (s *Service) UpsertCatalogModelOverlay(ctx context.Context, req *runtimev1.UpsertCatalogModelOverlayRequest) (*runtimev1.UpsertCatalogModelOverlayResponse, error) {
	subjectUserID, err := requireSubjectUserID(ctx)
	if err != nil {
		return nil, err
	}
	modelCatalog := s.modelCatalogResolver()
	if modelCatalog == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}
	if req == nil || req.GetModel() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	modelEntry := catalogModelInputToEntry(req.GetProvider(), req.GetModel())
	voices := make([]aicatalog.VoiceEntry, 0, len(req.GetVoices()))
	for _, voice := range req.GetVoices() {
		voices = append(voices, catalogVoiceProtoToEntry(voice))
	}
	workflows := make([]aicatalog.VoiceWorkflowModel, 0, len(req.GetVoiceWorkflowModels()))
	for _, workflow := range req.GetVoiceWorkflowModels() {
		workflows = append(workflows, catalogWorkflowProtoToEntry(workflow))
	}
	var binding *aicatalog.ModelWorkflowBinding
	if req.GetModelWorkflowBinding() != nil {
		item := catalogBindingProtoToEntry(req.GetModelWorkflowBinding())
		binding = &item
	}

	detail, record, err := modelCatalog.UpsertModelOverlayForSubject(subjectUserID, req.GetProvider(), modelEntry, voices, workflows, binding)
	if err != nil {
		switch {
		case errors.Is(err, aicatalog.ErrCatalogMutationDisabled):
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
				ActionHint: "configure_runtime_model_catalog_custom_dir",
			})
		case errors.Is(err, aicatalog.ErrProviderUnsupported):
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		default:
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
				ActionHint: "fix_provider_catalog_yaml",
				Message:    err.Error(),
			})
		}
	}

	return &runtimev1.UpsertCatalogModelOverlayResponse{
		Provider: modelCatalogProviderEntryFromRecord(record),
		Model:    mapCatalogModelDetail(detail),
		Warnings: mapCatalogWarnings(detail.Warnings),
	}, nil
}

func (s *Service) DeleteCatalogModelOverlay(ctx context.Context, req *runtimev1.DeleteCatalogModelOverlayRequest) (*runtimev1.DeleteCatalogModelOverlayResponse, error) {
	subjectUserID, err := requireSubjectUserID(ctx)
	if err != nil {
		return nil, err
	}
	modelCatalog := s.modelCatalogResolver()
	if modelCatalog == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
			ActionHint: "configure_runtime_model_catalog_custom_dir",
		})
	}
	provider := strings.TrimSpace(req.GetProvider())
	modelID := strings.TrimSpace(req.GetModelId())
	if provider == "" || modelID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	record, err := modelCatalog.DeleteModelOverlayForSubject(subjectUserID, provider, modelID)
	if err != nil {
		switch {
		case errors.Is(err, aicatalog.ErrCatalogMutationDisabled):
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID, grpcerr.ReasonOptions{
				ActionHint: "configure_runtime_model_catalog_custom_dir",
			})
		case errors.Is(err, aicatalog.ErrProviderUnsupported):
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		default:
			return nil, s.internalProviderError("delete_catalog_model_overlay", err)
		}
	}

	return &runtimev1.DeleteCatalogModelOverlayResponse{
		Ack:      &runtimev1.Ack{Ok: true},
		Provider: modelCatalogProviderEntryFromRecord(record),
	}, nil
}

func lookupCatalogProviderRecord(records []aicatalog.CatalogProviderRecord, provider string) (aicatalog.CatalogProviderRecord, bool) {
	normalized := strings.ToLower(strings.TrimSpace(provider))
	for _, record := range records {
		if strings.ToLower(strings.TrimSpace(record.Provider)) == normalized {
			return record, true
		}
	}
	return aicatalog.CatalogProviderRecord{}, false
}

func providerWarnings(record aicatalog.CatalogProviderRecord) []aicatalog.CatalogOverlayWarning {
	if !record.HasOverlay {
		return nil
	}
	switch record.Source {
	case aicatalog.ProviderSourceOverridden:
		return []aicatalog.CatalogOverlayWarning{{
			Code:    "provider_has_model_overrides",
			Message: "One or more built-in models are overridden by a catalog overlay.",
		}}
	default:
		return []aicatalog.CatalogOverlayWarning{{
			Code:    "provider_has_custom_overlay",
			Message: "This provider includes custom catalog overlay entries.",
		}}
	}
}

func mapCatalogWarnings(warnings []aicatalog.CatalogOverlayWarning) []*runtimev1.CatalogOverlayWarning {
	if len(warnings) == 0 {
		return nil
	}
	out := make([]*runtimev1.CatalogOverlayWarning, 0, len(warnings))
	for _, warning := range warnings {
		out = append(out, &runtimev1.CatalogOverlayWarning{
			Code:    warning.Code,
			Message: warning.Message,
		})
	}
	return out
}

func mapCatalogModelSummary(model aicatalog.CatalogModelRecord) *runtimev1.CatalogModelSummary {
	return &runtimev1.CatalogModelSummary{
		Provider:           model.Model.Provider,
		ModelId:            model.Model.ModelID,
		ModelType:          model.Model.ModelType,
		UpdatedAt:          model.Model.UpdatedAt,
		Capabilities:       append([]string(nil), model.Model.Capabilities...),
		Source:             mapCatalogModelSource(model.Source),
		UserScoped:         model.UserScoped,
		SourceNote:         model.Model.SourceRef.Note,
		HasVoiceCatalog:    strings.TrimSpace(model.Model.VoiceSetID) != "",
		HasVideoGeneration: model.Model.VideoGeneration != nil,
	}
}

func mapCatalogModelDetail(detail aicatalog.CatalogModelDetailRecord) *runtimev1.CatalogModelDetail {
	return &runtimev1.CatalogModelDetail{
		Provider:             detail.Model.Provider,
		ModelId:              detail.Model.ModelID,
		ModelType:            detail.Model.ModelType,
		UpdatedAt:            detail.Model.UpdatedAt,
		Capabilities:         append([]string(nil), detail.Model.Capabilities...),
		Pricing:              mapCatalogPricing(detail.Model.Pricing),
		VoiceSetId:           detail.Model.VoiceSetID,
		VoiceDiscoveryMode:   detail.Model.VoiceDiscoveryMode,
		VoiceRefKinds:        append([]string(nil), detail.Model.VoiceRefKinds...),
		VideoGeneration:      mapCatalogVideoGeneration(detail.Model.VideoGeneration),
		SourceRef:            mapCatalogSourceRef(detail.Model.SourceRef),
		Source:               mapCatalogModelSource(detail.Source),
		UserScoped:           detail.UserScoped,
		Warnings:             mapCatalogWarnings(detail.Warnings),
		Voices:               mapCatalogVoices(detail.Voices),
		VoiceWorkflowModels:  mapCatalogWorkflows(detail.VoiceWorkflowModels),
		ModelWorkflowBinding: mapCatalogBinding(detail.ModelWorkflowBinding),
	}
}

func mapCatalogPricing(pricing aicatalog.Pricing) *runtimev1.CatalogPricing {
	return &runtimev1.CatalogPricing{
		Unit:     pricing.Unit,
		Input:    pricing.Input,
		Output:   pricing.Output,
		Currency: pricing.Currency,
		AsOf:     pricing.AsOf,
		Notes:    pricing.Notes,
	}
}

func mapCatalogSourceRef(sourceRef aicatalog.SourceRef) *runtimev1.CatalogSourceRef {
	return &runtimev1.CatalogSourceRef{
		Url:         sourceRef.URL,
		RetrievedAt: sourceRef.RetrievedAt,
		Note:        sourceRef.Note,
	}
}

func mapCatalogVideoGeneration(video *aicatalog.VideoGenerationCapability) *runtimev1.CatalogVideoGenerationCapability {
	if video == nil {
		return nil
	}
	limits, _ := structpb.NewStruct(video.Limits)
	constraints, _ := structpb.NewStruct(video.Options.Constraints)
	roles := make([]*runtimev1.CatalogStringListEntry, 0, len(video.InputRoles))
	keys := make([]string, 0, len(video.InputRoles))
	for key := range video.InputRoles {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		roles = append(roles, &runtimev1.CatalogStringListEntry{
			Key:    key,
			Values: append([]string(nil), video.InputRoles[key]...),
		})
	}
	return &runtimev1.CatalogVideoGenerationCapability{
		Modes:             append([]string(nil), video.Modes...),
		InputRoles:        roles,
		Limits:            limits,
		OptionSupports:    append([]string(nil), video.Options.Supports...),
		OptionConstraints: constraints,
		Outputs: &runtimev1.CatalogVideoGenerationOutputs{
			VideoUrl:     video.Outputs.VideoURL,
			LastFrameUrl: video.Outputs.LastFrameURL,
		},
	}
}

func mapCatalogVoices(voices []aicatalog.VoiceEntry) []*runtimev1.CatalogVoiceEntry {
	if len(voices) == 0 {
		return nil
	}
	out := make([]*runtimev1.CatalogVoiceEntry, 0, len(voices))
	for _, voice := range voices {
		out = append(out, &runtimev1.CatalogVoiceEntry{
			VoiceSetId: voice.VoiceSetID,
			Provider:   voice.Provider,
			VoiceId:    voice.VoiceID,
			Name:       voice.Name,
			Langs:      append([]string(nil), voice.Langs...),
			ModelIds:   append([]string(nil), voice.ModelIDs...),
			SourceRef:  mapCatalogSourceRef(voice.SourceRef),
		})
	}
	return out
}

func mapCatalogWorkflows(workflows []aicatalog.VoiceWorkflowModel) []*runtimev1.CatalogWorkflowModel {
	if len(workflows) == 0 {
		return nil
	}
	out := make([]*runtimev1.CatalogWorkflowModel, 0, len(workflows))
	for _, workflow := range workflows {
		out = append(out, &runtimev1.CatalogWorkflowModel{
			WorkflowModelId:   workflow.WorkflowModelID,
			WorkflowType:      workflow.WorkflowType,
			InputContractRef:  workflow.InputContractRef,
			OutputPersistence: workflow.OutputPersistence,
			TargetModelRefs:   append([]string(nil), workflow.TargetModelRefs...),
			Langs:             append([]string(nil), workflow.Langs...),
			SourceRef:         mapCatalogSourceRef(workflow.SourceRef),
		})
	}
	return out
}

func mapCatalogBinding(binding *aicatalog.ModelWorkflowBinding) *runtimev1.CatalogModelWorkflowBinding {
	if binding == nil {
		return nil
	}
	return &runtimev1.CatalogModelWorkflowBinding{
		ModelId:           binding.ModelID,
		WorkflowModelRefs: append([]string(nil), binding.WorkflowModelRefs...),
		WorkflowTypes:     append([]string(nil), binding.WorkflowTypes...),
	}
}

func catalogModelInputToEntry(provider string, input *runtimev1.CatalogModelInput) aicatalog.ModelEntry {
	if input == nil {
		return aicatalog.ModelEntry{}
	}
	return aicatalog.ModelEntry{
		Provider:           strings.TrimSpace(firstNonEmptyString(input.GetProvider(), provider)),
		ModelID:            strings.TrimSpace(input.GetModelId()),
		ModelType:          strings.TrimSpace(input.GetModelType()),
		UpdatedAt:          strings.TrimSpace(input.GetUpdatedAt()),
		Capabilities:       append([]string(nil), input.GetCapabilities()...),
		Pricing:            catalogPricingProtoToEntry(input.GetPricing()),
		VoiceSetID:         strings.TrimSpace(input.GetVoiceSetId()),
		VoiceDiscoveryMode: strings.TrimSpace(input.GetVoiceDiscoveryMode()),
		VoiceRefKinds:      append([]string(nil), input.GetVoiceRefKinds()...),
		VideoGeneration:    catalogVideoGenerationProtoToEntry(input.GetVideoGeneration()),
		SourceRef:          catalogSourceRefProtoToEntry(input.GetSourceRef()),
	}
}

func catalogPricingProtoToEntry(pricing *runtimev1.CatalogPricing) aicatalog.Pricing {
	if pricing == nil {
		return aicatalog.Pricing{}
	}
	return aicatalog.Pricing{
		Unit:     pricing.GetUnit(),
		Input:    pricing.GetInput(),
		Output:   pricing.GetOutput(),
		Currency: pricing.GetCurrency(),
		AsOf:     pricing.GetAsOf(),
		Notes:    pricing.GetNotes(),
	}
}

func catalogSourceRefProtoToEntry(sourceRef *runtimev1.CatalogSourceRef) aicatalog.SourceRef {
	if sourceRef == nil {
		return aicatalog.SourceRef{}
	}
	return aicatalog.SourceRef{
		URL:         sourceRef.GetUrl(),
		RetrievedAt: sourceRef.GetRetrievedAt(),
		Note:        sourceRef.GetNote(),
	}
}

func catalogVideoGenerationProtoToEntry(video *runtimev1.CatalogVideoGenerationCapability) *aicatalog.VideoGenerationCapability {
	if video == nil {
		return nil
	}
	inputRoles := make(map[string][]string, len(video.GetInputRoles()))
	for _, role := range video.GetInputRoles() {
		inputRoles[strings.TrimSpace(role.GetKey())] = append([]string(nil), role.GetValues()...)
	}
	limits := map[string]any{}
	if video.GetLimits() != nil {
		limits = video.GetLimits().AsMap()
	}
	constraints := map[string]any{}
	if video.GetOptionConstraints() != nil {
		constraints = video.GetOptionConstraints().AsMap()
	}
	return &aicatalog.VideoGenerationCapability{
		Modes:      append([]string(nil), video.GetModes()...),
		InputRoles: inputRoles,
		Limits:     limits,
		Options: aicatalog.VideoGenerationOptions{
			Supports:    append([]string(nil), video.GetOptionSupports()...),
			Constraints: constraints,
		},
		Outputs: aicatalog.VideoGenerationOutputs{
			VideoURL:     video.GetOutputs() != nil && video.GetOutputs().GetVideoUrl(),
			LastFrameURL: video.GetOutputs() != nil && video.GetOutputs().GetLastFrameUrl(),
		},
	}
}

func catalogVoiceProtoToEntry(voice *runtimev1.CatalogVoiceEntry) aicatalog.VoiceEntry {
	if voice == nil {
		return aicatalog.VoiceEntry{}
	}
	return aicatalog.VoiceEntry{
		VoiceSetID: voice.GetVoiceSetId(),
		Provider:   voice.GetProvider(),
		VoiceID:    voice.GetVoiceId(),
		Name:       voice.GetName(),
		Langs:      append([]string(nil), voice.GetLangs()...),
		ModelIDs:   append([]string(nil), voice.GetModelIds()...),
		SourceRef:  catalogSourceRefProtoToEntry(voice.GetSourceRef()),
	}
}

func catalogWorkflowProtoToEntry(workflow *runtimev1.CatalogWorkflowModel) aicatalog.VoiceWorkflowModel {
	if workflow == nil {
		return aicatalog.VoiceWorkflowModel{}
	}
	return aicatalog.VoiceWorkflowModel{
		WorkflowModelID:   workflow.GetWorkflowModelId(),
		WorkflowType:      workflow.GetWorkflowType(),
		InputContractRef:  workflow.GetInputContractRef(),
		OutputPersistence: workflow.GetOutputPersistence(),
		TargetModelRefs:   append([]string(nil), workflow.GetTargetModelRefs()...),
		Langs:             append([]string(nil), workflow.GetLangs()...),
		SourceRef:         catalogSourceRefProtoToEntry(workflow.GetSourceRef()),
	}
}

func catalogBindingProtoToEntry(binding *runtimev1.CatalogModelWorkflowBinding) aicatalog.ModelWorkflowBinding {
	if binding == nil {
		return aicatalog.ModelWorkflowBinding{}
	}
	return aicatalog.ModelWorkflowBinding{
		ModelID:           binding.GetModelId(),
		WorkflowModelRefs: append([]string(nil), binding.GetWorkflowModelRefs()...),
		WorkflowTypes:     append([]string(nil), binding.GetWorkflowTypes()...),
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
