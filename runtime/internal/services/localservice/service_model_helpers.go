package localservice

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func manifestString(input map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		value, exists := input[key]
		if !exists {
			continue
		}
		text, ok := value.(string)
		if !ok {
			return "", false
		}
		return strings.TrimSpace(text), true
	}
	return "", false
}

func manifestStringDefault(input map[string]any, keys ...string) string {
	value, ok := manifestString(input, keys...)
	if !ok {
		return ""
	}
	return value
}

func manifestStringSlice(input map[string]any, key string) ([]string, error) {
	value, exists := input[key]
	if !exists || value == nil {
		return nil, nil
	}
	rawItems, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("invalid %s", key)
	}
	items := make([]string, 0, len(rawItems))
	for _, item := range rawItems {
		text, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("invalid %s entry", key)
		}
		items = append(items, strings.TrimSpace(text))
	}
	return normalizeStringSlice(items), nil
}

func manifestStringMap(input map[string]any, key string) (map[string]string, error) {
	value, exists := input[key]
	if !exists || value == nil {
		return map[string]string{}, nil
	}
	rawMap, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid %s", key)
	}
	result := make(map[string]string, len(rawMap))
	for k, v := range rawMap {
		text, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("invalid %s value", key)
		}
		result[k] = strings.TrimSpace(text)
	}
	return result, nil
}

func manifestStruct(input map[string]any, keys ...string) (*structpb.Struct, error) {
	for _, key := range keys {
		value, exists := input[key]
		if !exists || value == nil {
			continue
		}
		object, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("invalid %s", key)
		}
		result, err := structpb.NewStruct(object)
		if err != nil {
			return nil, fmt.Errorf("invalid %s", key)
		}
		return result, nil
	}
	return nil, nil
}

func (s *Service) RemoveLocalModel(_ context.Context, req *runtimev1.RemoveLocalModelRequest) (*runtimev1.RemoveLocalModelResponse, error) {
	localModelID := strings.TrimSpace(req.GetLocalModelId())
	if localModelID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "set_local_model_id",
		})
	}
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "install_or_select_existing_local_model",
		})
	}
	if boundServiceID := s.findBoundServiceID(localModelID); boundServiceID != "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)
	}
	model, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED, "model removed")
	if err != nil {
		return nil, err
	}
	if syncErr := s.SyncManagedLlamaAssets(context.Background()); syncErr != nil {
		s.logger.Warn("sync llama assets after remove failed", "local_model_id", localModelID, "error", syncErr)
	}
	return &runtimev1.RemoveLocalModelResponse{Model: model}, nil
}

func (s *Service) CollectDeviceProfile(_ context.Context, req *runtimev1.CollectDeviceProfileRequest) (*runtimev1.CollectDeviceProfileResponse, error) {
	return &runtimev1.CollectDeviceProfileResponse{Profile: collectDeviceProfile(req.GetExtraPorts()...)}, nil
}

func localModelSortCategory(model *runtimev1.LocalModelRecord) string {
	if model == nil {
		return "zzzz"
	}
	has := func(keys ...string) bool {
		for _, capability := range model.GetCapabilities() {
			capability = strings.ToLower(strings.TrimSpace(capability))
			for _, key := range keys {
				if capability == key {
					return true
				}
			}
		}
		return false
	}

	switch {
	case has("custom"):
		return "custom"
	case has("vision", "vl", "multimodal", "image.understand", "audio_chat", "video_chat", "text.generate.vision", "text.generate.audio", "text.generate.video"):
		return "vision"
	case has("image", "image.generate"):
		return "image"
	case has("tts", "speech.synthesize", "audio.synthesize"):
		return "tts"
	case has("stt", "speech.transcribe", "audio.transcribe"):
		return "stt"
	default:
		return "llm"
	}
}

func (s *Service) findBoundServiceID(localModelID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, service := range s.services {
		if service == nil {
			continue
		}
		if service.GetStatus() == runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED {
			continue
		}
		if strings.TrimSpace(service.GetLocalModelId()) == localModelID {
			return service.GetServiceId()
		}
	}
	return ""
}
