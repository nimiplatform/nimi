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
	rawOptions := dynamicMessageStringListField(message, "Options")
	if len(rawOptions) != 0 {
		return loadModelState{}, fmt.Errorf("managed wrapper load does not accept direct gosd options")
	}
	components, err := dynamicMessageComponentBindingsField(message, modelsRoot)
	if err != nil {
		return loadModelState{}, err
	}
	diffusionFA := dynamicMessageBoolField(message, "diffusion_fa")
	offloadToCPU := dynamicMessageBoolField(message, "offload_to_cpu")
	flowShift := dynamicMessageFloat32Field(message, "flow_shift")
	if flowShift < 0 {
		return loadModelState{}, fmt.Errorf("managed image flow shift must be non-negative")
	}
	options := managedImageOptions{
		Components:         components,
		DiffusionFA:        &diffusionFA,
		OffloadParamsToCPU: &offloadToCPU,
		FlowShift:          flowShift,
		QwenImageZeroCondT: dynamicMessageBoolField(message, "qwen_image_zero_cond_t"),
	}
	return loadModelState{
		ModelsRoot: modelsRoot,
		ModelPath:  modelPath,
		Options:    options,
		Threads:    dynamicMessageInt32Field(message, "Threads"),
	}, nil
}

func dynamicMessageComponentBindingsField(message *dynamicpb.Message, modelsRoot string) ([]managedImageComponent, error) {
	if message == nil {
		return nil, nil
	}
	field := message.Descriptor().Fields().ByName(protoreflect.Name("components"))
	if field == nil || !message.Has(field) {
		return nil, nil
	}
	list := message.Get(field).List()
	components := make([]managedImageComponent, 0, list.Len())
	for index := 0; index < list.Len(); index++ {
		value := list.Get(index).Message()
		component := managedImageComponent{
			OccurrenceID:  strings.TrimSpace(dynamicProtoMessageStringField(value, "occurrence_id")),
			Order:         dynamicProtoMessageInt32Field(value, "order"),
			Role:          strings.TrimSpace(dynamicProtoMessageStringField(value, "role")),
			ComponentKind: strings.TrimSpace(dynamicProtoMessageStringField(value, "component_kind")),
			EngineSlot:    strings.TrimSpace(dynamicProtoMessageStringField(value, "engine_slot")),
			Path:          resolveManagedImagePath(modelsRoot, dynamicProtoMessageStringField(value, "path")),
			Required:      dynamicProtoMessageBoolField(value, "required"),
		}
		components = append(components, component)
	}
	return normalizeStableDiffusionCPPComponents(components)
}

func dynamicProtoMessageStringField(message protoreflect.Message, fieldName string) string {
	if message == nil {
		return ""
	}
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return ""
	}
	return strings.TrimSpace(message.Get(field).String())
}

func dynamicProtoMessageInt32Field(message protoreflect.Message, fieldName string) int32 {
	if message == nil {
		return 0
	}
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return 0
	}
	return int32(message.Get(field).Int())
}

func dynamicProtoMessageBoolField(message protoreflect.Message, fieldName string) bool {
	if message == nil {
		return false
	}
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	return field != nil && message.Has(field) && message.Get(field).Bool()
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
		Mode:           ImageRequestMode(strings.TrimSpace(dynamicMessageStringField(message, "mode"))),
		Width:          dynamicMessageInt32Field(message, "width"),
		Height:         dynamicMessageInt32Field(message, "height"),
		Step:           dynamicMessageInt32Field(message, "step"),
		Seed:           dynamicMessageInt32Field(message, "seed"),
		PositivePrompt: strings.TrimSpace(dynamicMessageStringField(message, "positive_prompt")),
		NegativePrompt: strings.TrimSpace(dynamicMessageStringField(message, "negative_prompt")),
		Dst:            destination,
		Src:            strings.TrimSpace(dynamicMessageStringField(message, "src")),
		Mask:           strings.TrimSpace(dynamicMessageStringField(message, "mask")),
		ReferenceImage: readBytesField(message, "reference_image"),
		CFGScale:       dynamicMessageFloat32Field(message, "cfg_scale"),
		Sampler:        strings.TrimSpace(dynamicMessageStringField(message, "sampler")),
		Scheduler:      strings.TrimSpace(dynamicMessageStringField(message, "scheduler")),
	}, nil
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

func dynamicMessageBoolField(message *dynamicpb.Message, fieldName string) bool {
	if message == nil {
		return false
	}
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	return field != nil && message.Has(field) && message.Get(field).Bool()
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
