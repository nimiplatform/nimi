package managedimagebackend

import (
	"fmt"
	"path/filepath"
	"strings"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

func decodeLoadModelState(message *dynamicpb.Message) (loadModelState, error) {
	if message == nil {
		return loadModelState{}, fmt.Errorf("managed image load payload is required")
	}
	modelsRoot := strings.TrimSpace(dynamicMessageStringField(message, "ModelPath"))
	modelPath := resolveManagedImagePath(modelsRoot, dynamicMessageStringField(message, "ModelFile"))
	if strings.TrimSpace(modelPath) == "" {
		return loadModelState{}, fmt.Errorf("managed image model path is required")
	}
	options, err := parseManagedImageOptions(modelsRoot, dynamicMessageStringListField(message, "Options"))
	if err != nil {
		return loadModelState{}, err
	}
	return loadModelState{
		ModelsRoot: modelsRoot,
		ModelPath:  modelPath,
		Options:    options,
		CFGScale:   dynamicMessageFloat32Field(message, "CFGScale"),
		Threads:    dynamicMessageInt32Field(message, "Threads"),
	}, nil
}

func decodeGenerateImageState(message *dynamicpb.Message) (imageGenerateState, error) {
	if message == nil {
		return imageGenerateState{}, fmt.Errorf("managed image request payload is required")
	}
	destination := strings.TrimSpace(dynamicMessageStringField(message, "dst"))
	if destination == "" {
		return imageGenerateState{}, fmt.Errorf("managed image destination is required")
	}
	return imageGenerateState{
		Width:          dynamicMessageInt32Field(message, "width"),
		Height:         dynamicMessageInt32Field(message, "height"),
		Step:           dynamicMessageInt32Field(message, "step"),
		Seed:           dynamicMessageInt32Field(message, "seed"),
		PositivePrompt: strings.TrimSpace(dynamicMessageStringField(message, "positive_prompt")),
		NegativePrompt: strings.TrimSpace(dynamicMessageStringField(message, "negative_prompt")),
		Dst:            destination,
		Src:            strings.TrimSpace(dynamicMessageStringField(message, "src")),
		EnableParams:   strings.TrimSpace(dynamicMessageStringField(message, "EnableParameters")),
		RefImages:      dynamicMessageStringListField(message, "ref_images"),
	}, nil
}

func parseManagedImageOptions(modelsRoot string, options []string) (managedImageOptions, error) {
	var parsed managedImageOptions
	for _, option := range options {
		trimmed := strings.TrimSpace(option)
		if trimmed == "" {
			continue
		}
		key, value, hasValue := strings.Cut(trimmed, ":")
		normalizedKey := strings.ToLower(strings.TrimSpace(key))
		switch normalizedKey {
		case "diffusion_model":
			continue
		case "offload_params_to_cpu":
			if !hasValue {
				return managedImageOptions{}, fmt.Errorf("managed image option offload_params_to_cpu requires a boolean value")
			}
			switch strings.ToLower(strings.TrimSpace(value)) {
			case "true":
				flag := true
				parsed.OffloadParamsToCPU = &flag
			case "false":
				flag := false
				parsed.OffloadParamsToCPU = &flag
			default:
				return managedImageOptions{}, fmt.Errorf("managed image option offload_params_to_cpu requires true or false")
			}
		case "diffusion_fa":
			if !hasValue {
				return managedImageOptions{}, fmt.Errorf("managed image option diffusion_fa requires a boolean value")
			}
			switch strings.ToLower(strings.TrimSpace(value)) {
			case "true":
				flag := true
				parsed.DiffusionFA = &flag
			case "false":
				flag := false
				parsed.DiffusionFA = &flag
			default:
				return managedImageOptions{}, fmt.Errorf("managed image option diffusion_fa requires true or false")
			}
		case "sampler":
			if !hasValue || strings.TrimSpace(value) == "" {
				return managedImageOptions{}, fmt.Errorf("managed image option sampler requires a value")
			}
			parsed.Sampler = strings.TrimSpace(value)
		case "scheduler":
			if !hasValue || strings.TrimSpace(value) == "" {
				return managedImageOptions{}, fmt.Errorf("managed image option scheduler requires a value")
			}
			parsed.Scheduler = strings.TrimSpace(value)
		case "vae_path":
			path, err := resolveManagedImageOptionPath(modelsRoot, value)
			if err != nil {
				return managedImageOptions{}, err
			}
			parsed.VAEPath = path
		case "llm_path":
			path, err := resolveManagedImageOptionPath(modelsRoot, value)
			if err != nil {
				return managedImageOptions{}, err
			}
			parsed.LLMPath = path
		case "clip_l_path":
			path, err := resolveManagedImageOptionPath(modelsRoot, value)
			if err != nil {
				return managedImageOptions{}, err
			}
			parsed.ClipLPath = path
		case "t5xxl_path":
			path, err := resolveManagedImageOptionPath(modelsRoot, value)
			if err != nil {
				return managedImageOptions{}, err
			}
			parsed.T5XXLPath = path
		default:
			return managedImageOptions{}, fmt.Errorf("unsupported managed image option %q", normalizedKey)
		}
	}
	return parsed, nil
}

func resolveManagedImagePath(modelsRoot string, value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if filepath.IsAbs(trimmed) || strings.TrimSpace(modelsRoot) == "" {
		return trimmed
	}
	return filepath.Join(strings.TrimSpace(modelsRoot), filepath.FromSlash(trimmed))
}

func resolveManagedImageOptionPath(modelsRoot string, value string) (string, error) {
	path := resolveManagedImagePath(modelsRoot, value)
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("managed image option path is required")
	}
	return path, nil
}

func dynamicMessageStringField(message *dynamicpb.Message, fieldName string) string {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return ""
	}
	return strings.TrimSpace(message.Get(field).String())
}

func dynamicMessageInt32Field(message *dynamicpb.Message, fieldName string) int32 {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return 0
	}
	return int32(message.Get(field).Int())
}

func dynamicMessageFloat32Field(message *dynamicpb.Message, fieldName string) float32 {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return 0
	}
	return float32(message.Get(field).Float())
}

func dynamicMessageStringListField(message *dynamicpb.Message, fieldName string) []string {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return nil
	}
	list := message.Get(field).List()
	values := make([]string, 0, list.Len())
	for index := 0; index < list.Len(); index++ {
		trimmed := strings.TrimSpace(list.Get(index).String())
		if trimmed != "" {
			values = append(values, trimmed)
		}
	}
	return values
}

func resultMessage(success bool, message string, diag *LoadModelDiagnostics) *dynamicpb.Message {
	result := dynamicpb.NewMessage(resultMessageDescriptor)
	if field := result.Descriptor().Fields().ByName(protoreflect.Name("message")); field != nil && strings.TrimSpace(message) != "" {
		result.Set(field, protoreflect.ValueOfString(strings.TrimSpace(message)))
	}
	if field := result.Descriptor().Fields().ByName(protoreflect.Name("success")); field != nil {
		result.Set(field, protoreflect.ValueOfBool(success))
	}
	if diag != nil {
		if field := result.Descriptor().Fields().ByName(protoreflect.Name("cache_hit")); field != nil && diag.CacheHit {
			result.Set(field, protoreflect.ValueOfBool(diag.CacheHit))
		}
		if field := result.Descriptor().Fields().ByName(protoreflect.Name("resident_reused")); field != nil && diag.ResidentReused {
			result.Set(field, protoreflect.ValueOfBool(diag.ResidentReused))
		}
		if field := result.Descriptor().Fields().ByName(protoreflect.Name("resident_restarted")); field != nil && diag.ResidentRestarted {
			result.Set(field, protoreflect.ValueOfBool(diag.ResidentRestarted))
		}
	}
	return result
}

func generateImageProgressEvent(progress imageGenerateProgress) *dynamicpb.Message {
	event := dynamicpb.NewMessage(generateImageEventDescriptor)
	if field := event.Descriptor().Fields().ByName(protoreflect.Name("current_step")); field != nil && progress.CurrentStep > 0 {
		event.Set(field, protoreflect.ValueOfInt32(progress.CurrentStep))
	}
	if field := event.Descriptor().Fields().ByName(protoreflect.Name("total_steps")); field != nil && progress.TotalSteps > 0 {
		event.Set(field, protoreflect.ValueOfInt32(progress.TotalSteps))
	}
	if field := event.Descriptor().Fields().ByName(protoreflect.Name("progress_percent")); field != nil && progress.ProgressPercent > 0 {
		event.Set(field, protoreflect.ValueOfInt32(progress.ProgressPercent))
	}
	if field := event.Descriptor().Fields().ByName(protoreflect.Name("done")); field != nil {
		event.Set(field, protoreflect.ValueOfBool(false))
	}
	if field := event.Descriptor().Fields().ByName(protoreflect.Name("success")); field != nil {
		event.Set(field, protoreflect.ValueOfBool(true))
	}
	return event
}

func generateImageTerminalEvent(success bool, message string, diag *ImageGenerateDiagnostics) *dynamicpb.Message {
	event := dynamicpb.NewMessage(generateImageEventDescriptor)
	if field := event.Descriptor().Fields().ByName(protoreflect.Name("done")); field != nil {
		event.Set(field, protoreflect.ValueOfBool(true))
	}
	if field := event.Descriptor().Fields().ByName(protoreflect.Name("success")); field != nil {
		event.Set(field, protoreflect.ValueOfBool(success))
	}
	if field := event.Descriptor().Fields().ByName(protoreflect.Name("message")); field != nil && strings.TrimSpace(message) != "" {
		event.Set(field, protoreflect.ValueOfString(strings.TrimSpace(message)))
	}
	if diag != nil {
		if field := event.Descriptor().Fields().ByName(protoreflect.Name("queue_wait_ms")); field != nil && diag.QueueWaitMs > 0 {
			event.Set(field, protoreflect.ValueOfInt64(diag.QueueWaitMs))
		}
		if field := event.Descriptor().Fields().ByName(protoreflect.Name("generate_duration_ms")); field != nil && diag.GenerateDurationMs > 0 {
			event.Set(field, protoreflect.ValueOfInt64(diag.GenerateDurationMs))
		}
		if field := event.Descriptor().Fields().ByName(protoreflect.Name("queue_serialized")); field != nil && diag.QueueSerialized {
			event.Set(field, protoreflect.ValueOfBool(diag.QueueSerialized))
		}
		if field := event.Descriptor().Fields().ByName(protoreflect.Name("resident_reused")); field != nil && diag.ResidentReused {
			event.Set(field, protoreflect.ValueOfBool(diag.ResidentReused))
		}
	}
	return event
}
