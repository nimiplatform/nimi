package managedimagebackend

import (
	"fmt"
	"math"
	"strings"
	"sync"

	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

var (
	videoDescriptorOnce sync.Once
	videoDescriptorErr  error

	loadVideoModelRequestDescriptor protoreflect.MessageDescriptor
	videoOperationResultDescriptor  protoreflect.MessageDescriptor
	generateVideoRequestDescriptor  protoreflect.MessageDescriptor
	generateVideoEventDescriptor    protoreflect.MessageDescriptor
	videoFrameDescriptor            protoreflect.MessageDescriptor
	cancelVideoRequestDescriptor    protoreflect.MessageDescriptor
)

func ensureVideoDescriptors() error {
	videoDescriptorOnce.Do(func() {
		optional := descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL
		repeated := descriptorpb.FieldDescriptorProto_LABEL_REPEATED
		field := func(name string, number int32, kind descriptorpb.FieldDescriptorProto_Type) *descriptorpb.FieldDescriptorProto {
			return &descriptorpb.FieldDescriptorProto{Name: stringPtr(name), Number: int32Ptr(number), Label: optional.Enum(), Type: kind.Enum()}
		}
		repeatedMessage := func(name string, number int32, typeName string) *descriptorpb.FieldDescriptorProto {
			return &descriptorpb.FieldDescriptorProto{Name: stringPtr(name), Number: int32Ptr(number), Label: repeated.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_MESSAGE.Enum(), TypeName: stringPtr(typeName)}
		}
		file, err := protodesc.NewFile(&descriptorpb.FileDescriptorProto{
			Name:    stringPtr("nimi_managed_video_v1.proto"),
			Package: stringPtr("backendvideo"),
			Syntax:  stringPtr("proto3"),
			MessageType: []*descriptorpb.DescriptorProto{
				{Name: stringPtr("LoadVideoModelRequest"), Field: []*descriptorpb.FieldDescriptorProto{
					field("protocol_version", 1, descriptorpb.FieldDescriptorProto_TYPE_UINT32),
					field("process_key", 2, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("fl2va_diffusion_path", 3, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("ref2va_diffusion_path", 4, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("encoder_path", 5, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("video_vae_path", 6, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("audio_vae_path", 7, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("conditioning_mode", 8, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("cfg_scale", 9, descriptorpb.FieldDescriptorProto_TYPE_DOUBLE),
					field("flow_shift", 10, descriptorpb.FieldDescriptorProto_TYPE_DOUBLE),
					field("sample_method", 11, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("scheduler", 12, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("diffusion_flash_attention", 13, descriptorpb.FieldDescriptorProto_TYPE_BOOL),
					field("offload_to_cpu", 14, descriptorpb.FieldDescriptorProto_TYPE_BOOL),
					field("rng", 15, descriptorpb.FieldDescriptorProto_TYPE_STRING),
				}},
				{Name: stringPtr("VideoOperationResult"), Field: []*descriptorpb.FieldDescriptorProto{
					field("protocol_version", 1, descriptorpb.FieldDescriptorProto_TYPE_UINT32),
					field("success", 2, descriptorpb.FieldDescriptorProto_TYPE_BOOL),
					field("message", 3, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("error_kind", 4, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("reused", 5, descriptorpb.FieldDescriptorProto_TYPE_BOOL),
					field("package_identity", 6, descriptorpb.FieldDescriptorProto_TYPE_STRING),
				}},
				{Name: stringPtr("GenerateVideoRequest"), Field: []*descriptorpb.FieldDescriptorProto{
					field("protocol_version", 1, descriptorpb.FieldDescriptorProto_TYPE_UINT32),
					field("width", 2, descriptorpb.FieldDescriptorProto_TYPE_INT32),
					field("height", 3, descriptorpb.FieldDescriptorProto_TYPE_INT32),
					field("frame_count", 4, descriptorpb.FieldDescriptorProto_TYPE_INT32),
					field("fps", 5, descriptorpb.FieldDescriptorProto_TYPE_INT32),
					field("seed", 6, descriptorpb.FieldDescriptorProto_TYPE_INT64),
					field("prompt", 7, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("negative_prompt", 8, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("reference_image", 9, descriptorpb.FieldDescriptorProto_TYPE_BYTES),
				}},
				{Name: stringPtr("VideoFrame"), Field: []*descriptorpb.FieldDescriptorProto{
					field("rgb", 1, descriptorpb.FieldDescriptorProto_TYPE_BYTES),
					field("width", 2, descriptorpb.FieldDescriptorProto_TYPE_INT32),
					field("height", 3, descriptorpb.FieldDescriptorProto_TYPE_INT32),
				}},
				{Name: stringPtr("GenerateVideoEvent"), Field: []*descriptorpb.FieldDescriptorProto{
					field("protocol_version", 1, descriptorpb.FieldDescriptorProto_TYPE_UINT32),
					field("current_step", 2, descriptorpb.FieldDescriptorProto_TYPE_INT32),
					field("total_steps", 3, descriptorpb.FieldDescriptorProto_TYPE_INT32),
					field("done", 4, descriptorpb.FieldDescriptorProto_TYPE_BOOL),
					field("success", 5, descriptorpb.FieldDescriptorProto_TYPE_BOOL),
					field("message", 6, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					field("error_kind", 7, descriptorpb.FieldDescriptorProto_TYPE_STRING),
					repeatedMessage("frames", 8, ".backendvideo.VideoFrame"),
					field("frame_count", 9, descriptorpb.FieldDescriptorProto_TYPE_INT32),
					field("fps", 10, descriptorpb.FieldDescriptorProto_TYPE_INT32),
					field("audio_pcm_f32le", 11, descriptorpb.FieldDescriptorProto_TYPE_BYTES),
					field("audio_channels", 12, descriptorpb.FieldDescriptorProto_TYPE_INT32),
					field("audio_sample_rate", 13, descriptorpb.FieldDescriptorProto_TYPE_INT32),
					field("compute_ms", 14, descriptorpb.FieldDescriptorProto_TYPE_INT64),
				}},
				{Name: stringPtr("CancelVideoRequest"), Field: []*descriptorpb.FieldDescriptorProto{
					field("protocol_version", 1, descriptorpb.FieldDescriptorProto_TYPE_UINT32),
				}},
			},
		}, nil)
		if err != nil {
			videoDescriptorErr = fmt.Errorf("build managed video descriptors: %w", err)
			return
		}
		loadVideoModelRequestDescriptor = file.Messages().ByName("LoadVideoModelRequest")
		videoOperationResultDescriptor = file.Messages().ByName("VideoOperationResult")
		generateVideoRequestDescriptor = file.Messages().ByName("GenerateVideoRequest")
		generateVideoEventDescriptor = file.Messages().ByName("GenerateVideoEvent")
		videoFrameDescriptor = file.Messages().ByName("VideoFrame")
		cancelVideoRequestDescriptor = file.Messages().ByName("CancelVideoRequest")
		if loadVideoModelRequestDescriptor == nil || videoOperationResultDescriptor == nil || generateVideoRequestDescriptor == nil || generateVideoEventDescriptor == nil || videoFrameDescriptor == nil || cancelVideoRequestDescriptor == nil {
			videoDescriptorErr = fmt.Errorf("resolve managed video message descriptors")
		}
	})
	return videoDescriptorErr
}

func setUint32Field(message *dynamicpb.Message, name string, value uint32) {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field != nil {
		message.Set(field, protoreflect.ValueOfUint32(value))
	}
}

func setInt64Field(message *dynamicpb.Message, name string, value int64) {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field != nil {
		message.Set(field, protoreflect.ValueOfInt64(value))
	}
}

func setDoubleField(message *dynamicpb.Message, name string, value float64) {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field != nil {
		message.Set(field, protoreflect.ValueOfFloat64(value))
	}
}

func setBytesField(message *dynamicpb.Message, name string, value []byte) {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field != nil && len(value) > 0 {
		message.Set(field, protoreflect.ValueOfBytes(append([]byte(nil), value...)))
	}
}

func readUint32Field(message *dynamicpb.Message, name string) uint32 {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field == nil || !message.Has(field) {
		return 0
	}
	return uint32(message.Get(field).Uint())
}

func readDoubleField(message *dynamicpb.Message, name string) float64 {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field == nil || !message.Has(field) {
		return 0
	}
	return message.Get(field).Float()
}

func readBytesField(message *dynamicpb.Message, name string) []byte {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field == nil || !message.Has(field) {
		return nil
	}
	return append([]byte(nil), message.Get(field).Bytes()...)
}

func decodeVideoModelRequest(message *dynamicpb.Message) (VideoModelRequest, error) {
	if readUint32Field(message, "protocol_version") != VideoProtocolVersion {
		return VideoModelRequest{}, videoError(VideoErrorProtocolMismatch, fmt.Errorf("managed video protocol version mismatch"))
	}
	request := VideoModelRequest{
		ProcessKey:              readOptionalStringField(message, "process_key"),
		FL2VADiffusionPath:      readOptionalStringField(message, "fl2va_diffusion_path"),
		Ref2VADiffusionPath:     readOptionalStringField(message, "ref2va_diffusion_path"),
		EncoderPath:             readOptionalStringField(message, "encoder_path"),
		VideoVAEPath:            readOptionalStringField(message, "video_vae_path"),
		AudioVAEPath:            readOptionalStringField(message, "audio_vae_path"),
		ConditioningMode:        readOptionalStringField(message, "conditioning_mode"),
		CFGScale:                readDoubleField(message, "cfg_scale"),
		FlowShift:               readDoubleField(message, "flow_shift"),
		SampleMethod:            readOptionalStringField(message, "sample_method"),
		Scheduler:               readOptionalStringField(message, "scheduler"),
		DiffusionFlashAttention: readOptionalBoolField(message, "diffusion_flash_attention"),
		OffloadToCPU:            readOptionalBoolField(message, "offload_to_cpu"),
		RNG:                     readOptionalStringField(message, "rng"),
	}
	if strings.TrimSpace(request.ProcessKey) == "" || strings.TrimSpace(request.FL2VADiffusionPath) == "" || strings.TrimSpace(request.Ref2VADiffusionPath) == "" || strings.TrimSpace(request.EncoderPath) == "" || strings.TrimSpace(request.VideoVAEPath) == "" || strings.TrimSpace(request.AudioVAEPath) == "" {
		return VideoModelRequest{}, videoError(VideoErrorLoad, fmt.Errorf("managed video model request is incomplete"))
	}
	return request, nil
}

func decodeVideoGenerateRequest(message *dynamicpb.Message) (VideoGenerateRequest, error) {
	if readUint32Field(message, "protocol_version") != VideoProtocolVersion {
		return VideoGenerateRequest{}, videoError(VideoErrorProtocolMismatch, fmt.Errorf("managed video protocol version mismatch"))
	}
	return VideoGenerateRequest{
		Width:          int(readOptionalInt32Field(message, "width")),
		Height:         int(readOptionalInt32Field(message, "height")),
		FrameCount:     int(readOptionalInt32Field(message, "frame_count")),
		FPS:            int(readOptionalInt32Field(message, "fps")),
		Seed:           readOptionalInt64Field(message, "seed"),
		Prompt:         readOptionalStringField(message, "prompt"),
		NegativePrompt: readOptionalStringField(message, "negative_prompt"),
		ReferenceImage: readBytesField(message, "reference_image"),
	}, nil
}

func videoOperationResult(success bool, message, kind string, reused bool, packageIdentity string) *dynamicpb.Message {
	result := dynamicpb.NewMessage(videoOperationResultDescriptor)
	setUint32Field(result, "protocol_version", VideoProtocolVersion)
	setBoolField(result, "success", success)
	setStringField(result, "message", message)
	setStringField(result, "error_kind", kind)
	setBoolField(result, "reused", reused)
	setStringField(result, "package_identity", packageIdentity)
	return result
}

func videoProgressEvent(progress VideoGenerateProgress) *dynamicpb.Message {
	event := dynamicpb.NewMessage(generateVideoEventDescriptor)
	setUint32Field(event, "protocol_version", VideoProtocolVersion)
	setInt32Field(event, "current_step", progress.CurrentStep)
	setInt32Field(event, "total_steps", progress.TotalSteps)
	return event
}

func videoTerminalEvent(candidate VideoCandidate, err error) *dynamicpb.Message {
	event := dynamicpb.NewMessage(generateVideoEventDescriptor)
	setUint32Field(event, "protocol_version", VideoProtocolVersion)
	setBoolField(event, "done", true)
	if err != nil {
		setStringField(event, "message", err.Error())
		setStringField(event, "error_kind", VideoErrorKindOf(err))
		return event
	}
	setBoolField(event, "success", true)
	setStringField(event, "message", "generated")
	setInt32Field(event, "frame_count", int32(candidate.FrameCount))
	setInt32Field(event, "fps", int32(candidate.FPS))
	setInt32Field(event, "audio_channels", int32(candidate.Audio.Channels))
	setInt32Field(event, "audio_sample_rate", int32(candidate.Audio.SampleRate))
	setInt64Field(event, "compute_ms", candidate.ComputeMS)
	frameField := event.Descriptor().Fields().ByName("frames")
	frames := event.Mutable(frameField).List()
	for _, value := range candidate.Frames {
		frame := dynamicpb.NewMessage(videoFrameDescriptor)
		setBytesField(frame, "rgb", value.RGBBytes)
		setInt32Field(frame, "width", int32(value.Width))
		setInt32Field(frame, "height", int32(value.Height))
		frames.Append(protoreflect.ValueOfMessage(frame))
	}
	audio := make([]byte, len(candidate.Audio.PCMSamples)*4)
	for index, sample := range candidate.Audio.PCMSamples {
		bits := math.Float32bits(sample)
		audio[index*4] = byte(bits)
		audio[index*4+1] = byte(bits >> 8)
		audio[index*4+2] = byte(bits >> 16)
		audio[index*4+3] = byte(bits >> 24)
	}
	setBytesField(event, "audio_pcm_f32le", audio)
	return event
}

func protocolErrorResult(err error) *dynamicpb.Message {
	return videoOperationResult(false, err.Error(), VideoErrorKindOf(err), false, "")
}
