package managedimagebackend

import (
	"context"
	"fmt"
	"io"
	"math"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

const managedVideoMaxMessageBytes = 512 << 20

func LoadVideoModel(ctx context.Context, request VideoModelRequest) (*VideoLoadDiagnostics, error) {
	if err := ensureVideoDescriptors(); err != nil {
		return nil, err
	}
	conn, err := dialVideoBackend(ctx, request.BackendAddress)
	if err != nil {
		return nil, err
	}
	defer func() { _ = conn.Close() }()

	message := dynamicpb.NewMessage(loadVideoModelRequestDescriptor)
	setUint32Field(message, "protocol_version", VideoProtocolVersion)
	setStringField(message, "process_key", request.ProcessKey)
	setStringField(message, "fl2va_diffusion_path", request.FL2VADiffusionPath)
	setStringField(message, "ref2va_diffusion_path", request.Ref2VADiffusionPath)
	setStringField(message, "encoder_path", request.EncoderPath)
	setStringField(message, "video_vae_path", request.VideoVAEPath)
	setStringField(message, "audio_vae_path", request.AudioVAEPath)
	setStringField(message, "conditioning_mode", request.ConditioningMode)
	setDoubleField(message, "cfg_scale", request.CFGScale)
	setDoubleField(message, "flow_shift", request.FlowShift)
	setStringField(message, "sample_method", request.SampleMethod)
	setStringField(message, "scheduler", request.Scheduler)
	setBoolField(message, "diffusion_flash_attention", request.DiffusionFlashAttention)
	setBoolField(message, "offload_to_cpu", request.OffloadToCPU)
	setStringField(message, "rng", request.RNG)
	response := dynamicpb.NewMessage(videoOperationResultDescriptor)
	if err := conn.Invoke(ctx, backendLoadVideoModelMethod, message, response); err != nil {
		return nil, contextVideoError(ctx, fmt.Errorf("load managed video model: %w", err))
	}
	return readVideoLoadResult(response)
}

func GenerateVideo(ctx context.Context, request VideoGenerateRequest) (VideoCandidate, error) {
	if err := ensureVideoDescriptors(); err != nil {
		return VideoCandidate{}, err
	}
	conn, err := dialVideoBackend(ctx, request.BackendAddress)
	if err != nil {
		return VideoCandidate{}, err
	}
	defer func() { _ = conn.Close() }()

	message := dynamicpb.NewMessage(generateVideoRequestDescriptor)
	setUint32Field(message, "protocol_version", VideoProtocolVersion)
	setInt32Field(message, "width", int32(request.Width))
	setInt32Field(message, "height", int32(request.Height))
	setInt32Field(message, "frame_count", int32(request.FrameCount))
	setInt32Field(message, "fps", int32(request.FPS))
	setInt64Field(message, "seed", request.Seed)
	setStringField(message, "prompt", request.Prompt)
	setStringField(message, "negative_prompt", request.NegativePrompt)
	setBytesField(message, "reference_image", request.ReferenceImage)

	stream, err := conn.NewStream(ctx, &grpc.StreamDesc{ServerStreams: true}, backendGenerateVideoMethod)
	if err != nil {
		return VideoCandidate{}, contextVideoError(ctx, fmt.Errorf("open managed video stream: %w", err))
	}
	if err := stream.SendMsg(message); err != nil {
		return VideoCandidate{}, contextVideoError(ctx, fmt.Errorf("send managed video request: %w", err))
	}
	if err := stream.CloseSend(); err != nil {
		return VideoCandidate{}, contextVideoError(ctx, fmt.Errorf("close managed video request stream: %w", err))
	}
	for {
		event := dynamicpb.NewMessage(generateVideoEventDescriptor)
		if err := stream.RecvMsg(event); err != nil {
			if err == io.EOF {
				return VideoCandidate{}, videoError(VideoErrorInference, fmt.Errorf("managed video stream closed without terminal event"))
			}
			return VideoCandidate{}, contextVideoError(ctx, fmt.Errorf("receive managed video event: %w", err))
		}
		if readUint32Field(event, "protocol_version") != VideoProtocolVersion {
			return VideoCandidate{}, videoError(VideoErrorProtocolMismatch, fmt.Errorf("managed video response protocol version mismatch"))
		}
		if !readOptionalBoolField(event, "done") {
			progress := VideoGenerateProgress{CurrentStep: readOptionalInt32Field(event, "current_step"), TotalSteps: readOptionalInt32Field(event, "total_steps")}
			if request.OnProgress != nil && (progress.CurrentStep != 0 || progress.TotalSteps != 0) {
				request.OnProgress(progress)
			}
			continue
		}
		if !readOptionalBoolField(event, "success") {
			kind := readOptionalStringField(event, "error_kind")
			if kind == "" {
				kind = VideoErrorInference
			}
			return VideoCandidate{}, videoError(kind, fmt.Errorf("generate managed video: %s", defaultMessage(readOptionalStringField(event, "message"), "backend returned unsuccessful result")))
		}
		candidate, err := decodeVideoCandidate(event)
		if err != nil {
			return VideoCandidate{}, err
		}
		if err := validateVideoCandidate(request, candidate); err != nil {
			return VideoCandidate{}, err
		}
		return candidate, nil
	}
}

// CancelVideo requests cooperative sd_cancel_generation and returns only after
// the wrapper has observed the active generate call finish.
func CancelVideo(ctx context.Context, backendAddress string) error {
	if err := ensureVideoDescriptors(); err != nil {
		return err
	}
	conn, err := dialVideoBackend(ctx, backendAddress)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	request := dynamicpb.NewMessage(cancelVideoRequestDescriptor)
	setUint32Field(request, "protocol_version", VideoProtocolVersion)
	response := dynamicpb.NewMessage(videoOperationResultDescriptor)
	if err := conn.Invoke(ctx, backendCancelVideoMethod, request, response); err != nil {
		return contextVideoError(ctx, fmt.Errorf("cancel managed video: %w", err))
	}
	if readUint32Field(response, "protocol_version") != VideoProtocolVersion {
		return videoError(VideoErrorProtocolMismatch, fmt.Errorf("managed video cancel response protocol version mismatch"))
	}
	if !readOptionalBoolField(response, "success") {
		kind := readOptionalStringField(response, "error_kind")
		if kind == "" {
			kind = VideoErrorCanceled
		}
		return videoError(kind, fmt.Errorf("cancel managed video: %s", defaultMessage(readOptionalStringField(response, "message"), "backend rejected cancellation")))
	}
	return nil
}

func dialVideoBackend(ctx context.Context, address string) (*grpc.ClientConn, error) {
	trimmed := strings.TrimSpace(address)
	if trimmed == "" {
		return nil, fmt.Errorf("managed video backend address is required")
	}
	conn, err := grpc.DialContext(ctx, trimmed,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(managedVideoMaxMessageBytes), grpc.MaxCallSendMsgSize(managedVideoMaxMessageBytes)),
	)
	if err != nil {
		return nil, contextVideoError(ctx, fmt.Errorf("dial managed video backend: %w", err))
	}
	return conn, nil
}

func readVideoLoadResult(response *dynamicpb.Message) (*VideoLoadDiagnostics, error) {
	if readUint32Field(response, "protocol_version") != VideoProtocolVersion {
		return nil, videoError(VideoErrorProtocolMismatch, fmt.Errorf("managed video load response protocol version mismatch"))
	}
	if !readOptionalBoolField(response, "success") {
		kind := readOptionalStringField(response, "error_kind")
		if kind == "" {
			kind = VideoErrorLoad
		}
		return nil, videoError(kind, fmt.Errorf("load managed video model: %s", defaultMessage(readOptionalStringField(response, "message"), "backend returned unsuccessful result")))
	}
	return &VideoLoadDiagnostics{
		Reused:          readOptionalBoolField(response, "reused"),
		PackageIdentity: readOptionalStringField(response, "package_identity"),
	}, nil
}

func decodeVideoCandidate(event *dynamicpb.Message) (VideoCandidate, error) {
	candidate := VideoCandidate{
		FrameCount: int(readOptionalInt32Field(event, "frame_count")),
		FPS:        int(readOptionalInt32Field(event, "fps")),
		ComputeMS:  readOptionalInt64Field(event, "compute_ms"),
		Audio: VideoAudio{
			Channels:   int(readOptionalInt32Field(event, "audio_channels")),
			SampleRate: int(readOptionalInt32Field(event, "audio_sample_rate")),
		},
	}
	frameField := event.Descriptor().Fields().ByName(protoreflect.Name("frames"))
	if frameField != nil && event.Has(frameField) {
		frames := event.Get(frameField).List()
		candidate.Frames = make([]VideoFrame, 0, frames.Len())
		for index := 0; index < frames.Len(); index++ {
			frame := frames.Get(index).Message()
			candidate.Frames = append(candidate.Frames, VideoFrame{
				RGBBytes: readProtoBytesField(frame, "rgb"),
				Width:    int(dynamicProtoMessageInt32Field(frame, "width")),
				Height:   int(dynamicProtoMessageInt32Field(frame, "height")),
			})
		}
	}
	audio := readBytesField(event, "audio_pcm_f32le")
	if len(audio)%4 != 0 {
		return VideoCandidate{}, videoError(VideoErrorPostcondition, fmt.Errorf("managed video audio payload is not float32-aligned"))
	}
	candidate.Audio.PCMSamples = make([]float32, len(audio)/4)
	for index := range candidate.Audio.PCMSamples {
		offset := index * 4
		bits := uint32(audio[offset]) | uint32(audio[offset+1])<<8 | uint32(audio[offset+2])<<16 | uint32(audio[offset+3])<<24
		candidate.Audio.PCMSamples[index] = math.Float32frombits(bits)
	}
	return candidate, nil
}

func readProtoBytesField(message protoreflect.Message, name string) []byte {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field == nil || !message.Has(field) {
		return nil
	}
	return append([]byte(nil), message.Get(field).Bytes()...)
}
