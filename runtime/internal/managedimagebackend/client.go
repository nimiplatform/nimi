package managedimagebackend

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

const (
	backendLoadModelMethod     = "/backend.Backend/LoadModel"
	backendGenerateImageMethod = "/backend.Backend/GenerateImage"
	backendFreeModelMethod     = "/backend.Backend/Free"
)

type ImageRequest struct {
	BackendAddress string
	ModelsRoot     string
	ModelPath      string
	Options        []string
	Components     []ComponentBinding
	CFGScale       float32
	Threads        int32
	Width          int32
	Height         int32
	Step           int32
	Seed           int32
	PositivePrompt string
	NegativePrompt string
	Dst            string
	Src            string
	EnableParams   string
	RefImages      []string
	OnProgress     func(ImageGenerateProgress)
}

type LoadModelRequest struct {
	BackendAddress string
	ModelsRoot     string
	ModelPath      string
	Options        []string
	Components     []ComponentBinding
	CFGScale       float32
	Threads        int32
}

// ComponentBinding is the ordered, Runtime-resolved component description
// carried to the managed image backend. EngineSlot remains a backend-private
// injection hint; occurrence identity, order, policy, weight, and options are
// retained so a backend cannot collapse two exact workflow occurrences into a
// slot-only map.
type ComponentBinding struct {
	OccurrenceID  string
	Order         int32
	Role          string
	ComponentKind string
	EngineSlot    string
	Path          string
	Required      bool
	Weight        string
	OptionsJSON   string
}

type LoadModelDiagnostics struct {
	CacheHit          bool
	ResidentReused    bool
	ResidentRestarted bool
}

type ImageGenerateDiagnostics struct {
	QueueWaitMs        int64
	GenerateDurationMs int64
	QueueSerialized    bool
	ResidentReused     bool
}

type ImageGenerateProgress struct {
	CurrentStep     int32
	TotalSteps      int32
	ProgressPercent int32
}

var (
	descriptorOnce sync.Once
	descriptorErr  error

	resultMessageDescriptor           protoreflect.MessageDescriptor
	modelOptionsMessageDescriptor     protoreflect.MessageDescriptor
	componentBindingMessageDescriptor protoreflect.MessageDescriptor
	generateImageMessageDescriptor    protoreflect.MessageDescriptor
	generateImageEventDescriptor      protoreflect.MessageDescriptor
)

func cloneComponentBindings(input []ComponentBinding) []ComponentBinding {
	if len(input) == 0 {
		return nil
	}
	return append([]ComponentBinding(nil), input...)
}

func LoadModelAndGenerateImage(ctx context.Context, req ImageRequest) (*ImageGenerateDiagnostics, error) {
	if strings.TrimSpace(req.Dst) == "" {
		return nil, fmt.Errorf("managed media destination is required")
	}
	if _, err := LoadModel(ctx, LoadModelRequest{
		BackendAddress: req.BackendAddress,
		ModelsRoot:     req.ModelsRoot,
		ModelPath:      req.ModelPath,
		Options:        req.Options,
		Components:     cloneComponentBindings(req.Components),
		CFGScale:       req.CFGScale,
		Threads:        req.Threads,
	}); err != nil {
		return nil, err
	}
	return GenerateImage(ctx, req)
}

func GenerateImage(ctx context.Context, req ImageRequest) (*ImageGenerateDiagnostics, error) {
	if strings.TrimSpace(req.Dst) == "" {
		return nil, fmt.Errorf("managed media destination is required")
	}
	if err := ensureDescriptors(); err != nil {
		return nil, err
	}

	conn, err := grpc.DialContext(
		ctx,
		strings.TrimSpace(req.BackendAddress),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		slog.Warn("managed image backend dial failed",
			"operation", "generate",
			"backend_address", strings.TrimSpace(req.BackendAddress),
			"error", err,
		)
		return nil, fmt.Errorf("dial managed media backend: %w", err)
	}
	defer func() { _ = conn.Close() }()
	slog.Info("managed image backend dial ready",
		"operation", "generate",
		"backend_address", strings.TrimSpace(req.BackendAddress),
		"model_path", strings.TrimSpace(req.ModelPath),
	)

	generateReq := dynamicpb.NewMessage(generateImageMessageDescriptor)
	setInt32Field(generateReq, "width", req.Width)
	setInt32Field(generateReq, "height", req.Height)
	setInt32Field(generateReq, "step", req.Step)
	setInt32Field(generateReq, "seed", req.Seed)
	setStringField(generateReq, "positive_prompt", req.PositivePrompt)
	setStringField(generateReq, "negative_prompt", req.NegativePrompt)
	setStringField(generateReq, "dst", req.Dst)
	setStringField(generateReq, "src", req.Src)
	setStringField(generateReq, "EnableParameters", req.EnableParams)
	setRepeatedStringField(generateReq, "ref_images", req.RefImages)

	invokeStartedAt := time.Now()
	slog.Info("managed image backend invoke start",
		"operation", "generate",
		"backend_address", strings.TrimSpace(req.BackendAddress),
		"model_path", strings.TrimSpace(req.ModelPath),
		"width", req.Width,
		"height", req.Height,
		"step", req.Step,
	)
	stream, err := conn.NewStream(ctx, &grpc.StreamDesc{ServerStreams: true}, backendGenerateImageMethod)
	if err != nil {
		return nil, fmt.Errorf("open managed media generate stream: %w", err)
	}
	if err := stream.SendMsg(generateReq); err != nil {
		return nil, fmt.Errorf("send managed media generate request: %w", err)
	}
	if err := stream.CloseSend(); err != nil {
		return nil, fmt.Errorf("close managed media generate request stream: %w", err)
	}
	sawResultTerminalCandidate := false
	for {
		event := dynamicpb.NewMessage(generateImageEventDescriptor)
		if err := stream.RecvMsg(event); err != nil {
			if err == io.EOF {
				break
			}
			slog.Warn("managed image backend invoke failed",
				"operation", "generate",
				"backend_address", strings.TrimSpace(req.BackendAddress),
				"model_path", strings.TrimSpace(req.ModelPath),
				"duration_ms", time.Since(invokeStartedAt).Milliseconds(),
				"error", err,
			)
			return nil, fmt.Errorf("generate managed media image: %w", err)
		}
		progress, hasProgress, done, success, message, diag := readGenerateImageEvent(event)
		if isGenerateResultTerminalCandidate(progress, done, success, message, diag) {
			sawResultTerminalCandidate = true
			continue
		}
		if hasProgress && req.OnProgress != nil {
			req.OnProgress(progress)
		}
		if !done {
			continue
		}
		slog.Info("managed image backend invoke completed",
			"operation", "generate",
			"backend_address", strings.TrimSpace(req.BackendAddress),
			"model_path", strings.TrimSpace(req.ModelPath),
			"duration_ms", time.Since(invokeStartedAt).Milliseconds(),
			"queue_wait_ms", diag.QueueWaitMs,
			"generate_duration_ms", diag.GenerateDurationMs,
			"queue_serialized", diag.QueueSerialized,
		)
		if !success {
			return nil, fmt.Errorf("generate managed media image failed: %s", defaultMessage(message, "backend returned unsuccessful image result"))
		}
		return diag, nil
	}
	if sawResultTerminalCandidate {
		if err := requireGeneratedImageArtifact(req.Dst); err != nil {
			slog.Warn("managed image backend result terminal rejected",
				"operation", "generate",
				"backend_address", strings.TrimSpace(req.BackendAddress),
				"model_path", strings.TrimSpace(req.ModelPath),
				"duration_ms", time.Since(invokeStartedAt).Milliseconds(),
				"error", err,
			)
			return nil, fmt.Errorf("generate managed media image: backend result terminal did not produce artifact: %w", err)
		}
		diag := &ImageGenerateDiagnostics{
			GenerateDurationMs: time.Since(invokeStartedAt).Milliseconds(),
		}
		slog.Info("managed image backend invoke completed",
			"operation", "generate",
			"backend_address", strings.TrimSpace(req.BackendAddress),
			"model_path", strings.TrimSpace(req.ModelPath),
			"duration_ms", diag.GenerateDurationMs,
			"terminal_shape", "result",
		)
		return diag, nil
	}
	// Stream closed (io.EOF) before a terminal event arrived.
	slog.Warn("managed image backend invoke failed",
		"operation", "generate",
		"backend_address", strings.TrimSpace(req.BackendAddress),
		"model_path", strings.TrimSpace(req.ModelPath),
		"duration_ms", time.Since(invokeStartedAt).Milliseconds(),
		"error", "missing terminal backend event",
	)
	return nil, fmt.Errorf("generate managed media image: missing terminal backend event")
}

func LoadModel(ctx context.Context, req LoadModelRequest) (*LoadModelDiagnostics, error) {
	if strings.TrimSpace(req.BackendAddress) == "" {
		return nil, fmt.Errorf("local backend address is required")
	}
	if strings.TrimSpace(req.ModelsRoot) == "" {
		return nil, fmt.Errorf("local models root is required")
	}
	if strings.TrimSpace(req.ModelPath) == "" {
		return nil, fmt.Errorf("managed media model path is required")
	}
	if err := ensureDescriptors(); err != nil {
		return nil, err
	}

	conn, err := grpc.DialContext(
		ctx,
		strings.TrimSpace(req.BackendAddress),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		slog.Warn("managed image backend dial failed",
			"operation", "load",
			"backend_address", strings.TrimSpace(req.BackendAddress),
			"error", err,
		)
		return nil, fmt.Errorf("dial managed media backend: %w", err)
	}
	defer func() { _ = conn.Close() }()
	slog.Info("managed image backend dial ready",
		"operation", "load",
		"backend_address", strings.TrimSpace(req.BackendAddress),
		"model_path", strings.TrimSpace(req.ModelPath),
	)

	loadReq := dynamicpb.NewMessage(modelOptionsMessageDescriptor)
	setStringField(loadReq, "ModelPath", req.ModelsRoot)
	setStringField(loadReq, "ModelFile", req.ModelPath)
	setInt32Field(loadReq, "Threads", req.Threads)
	setFloatField(loadReq, "CFGScale", req.CFGScale)
	setRepeatedStringField(loadReq, "Options", req.Options)
	setRepeatedComponentBindingField(loadReq, req.Components)

	loadResp := dynamicpb.NewMessage(resultMessageDescriptor)
	invokeStartedAt := time.Now()
	slog.Info("managed image backend invoke start",
		"operation", "load",
		"backend_address", strings.TrimSpace(req.BackendAddress),
		"model_path", strings.TrimSpace(req.ModelPath),
		"options_count", len(req.Options),
		"cfg_scale", req.CFGScale,
		"threads", req.Threads,
	)
	if err := conn.Invoke(ctx, backendLoadModelMethod, loadReq, loadResp); err != nil {
		slog.Warn("managed image backend invoke failed",
			"operation", "load",
			"backend_address", strings.TrimSpace(req.BackendAddress),
			"model_path", strings.TrimSpace(req.ModelPath),
			"duration_ms", time.Since(invokeStartedAt).Milliseconds(),
			"error", err,
		)
		return nil, fmt.Errorf("load managed media model: %w", err)
	}
	slog.Info("managed image backend invoke completed",
		"operation", "load",
		"backend_address", strings.TrimSpace(req.BackendAddress),
		"model_path", strings.TrimSpace(req.ModelPath),
		"duration_ms", time.Since(invokeStartedAt).Milliseconds(),
	)
	success, message, diag := readResult(loadResp)
	if !success {
		return nil, fmt.Errorf("load managed media model failed: %s", defaultMessage(message, "backend returned unsuccessful load result"))
	}
	return diag, nil
}

func FreeModel(ctx context.Context, req LoadModelRequest) error {
	if strings.TrimSpace(req.BackendAddress) == "" {
		return fmt.Errorf("local backend address is required")
	}
	if err := ensureDescriptors(); err != nil {
		return err
	}

	conn, err := grpc.DialContext(
		ctx,
		strings.TrimSpace(req.BackendAddress),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		return fmt.Errorf("dial managed media backend: %w", err)
	}
	defer func() { _ = conn.Close() }()

	freeReq := dynamicpb.NewMessage(modelOptionsMessageDescriptor)
	setStringField(freeReq, "ModelPath", req.ModelsRoot)
	setStringField(freeReq, "ModelFile", req.ModelPath)
	setInt32Field(freeReq, "Threads", req.Threads)
	setFloatField(freeReq, "CFGScale", req.CFGScale)
	setRepeatedStringField(freeReq, "Options", req.Options)
	setRepeatedComponentBindingField(freeReq, req.Components)

	freeResp := dynamicpb.NewMessage(resultMessageDescriptor)
	if err := conn.Invoke(ctx, backendFreeModelMethod, freeReq, freeResp); err != nil {
		return fmt.Errorf("free managed media model: %w", err)
	}
	if success, message, _ := readResult(freeResp); !success {
		return fmt.Errorf("free managed media model failed: %s", defaultMessage(message, "backend returned unsuccessful free result"))
	}
	return nil
}

func ensureDescriptors() error {
	descriptorOnce.Do(func() {
		fileDescriptor, err := protodesc.NewFile((&descriptorpb.FileDescriptorProto{
			Name:    stringPtr("localai_backend_min.proto"),
			Package: stringPtr("backend"),
			Syntax:  stringPtr("proto3"),
			MessageType: []*descriptorpb.DescriptorProto{
				{
					Name: stringPtr("Result"),
					Field: []*descriptorpb.FieldDescriptorProto{
						{
							Name:   stringPtr("message"),
							Number: int32Ptr(1),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
						{
							Name:   stringPtr("success"),
							Number: int32Ptr(2),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum(),
						},
						{
							Name:   stringPtr("cache_hit"),
							Number: int32Ptr(3),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum(),
						},
						{
							Name:   stringPtr("resident_reused"),
							Number: int32Ptr(4),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum(),
						},
						{
							Name:   stringPtr("resident_restarted"),
							Number: int32Ptr(5),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum(),
						},
					},
				},
				{
					Name: stringPtr("ComponentBinding"),
					Field: []*descriptorpb.FieldDescriptorProto{
						{Name: stringPtr("occurrence_id"), Number: int32Ptr(1), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
						{Name: stringPtr("order"), Number: int32Ptr(2), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum()},
						{Name: stringPtr("role"), Number: int32Ptr(3), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
						{Name: stringPtr("component_kind"), Number: int32Ptr(4), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
						{Name: stringPtr("engine_slot"), Number: int32Ptr(5), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
						{Name: stringPtr("path"), Number: int32Ptr(6), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
						{Name: stringPtr("required"), Number: int32Ptr(7), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum()},
						{Name: stringPtr("weight"), Number: int32Ptr(8), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
						{Name: stringPtr("options_json"), Number: int32Ptr(9), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
					},
				},
				{
					Name: stringPtr("ModelOptions"),
					Field: []*descriptorpb.FieldDescriptorProto{
						{
							Name:   stringPtr("Model"),
							Number: int32Ptr(1),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
						{
							Name:   stringPtr("Threads"),
							Number: int32Ptr(15),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum(),
						},
						{
							Name:   stringPtr("ModelFile"),
							Number: int32Ptr(21),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
						{
							Name:   stringPtr("CFGScale"),
							Number: int32Ptr(29),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_FLOAT.Enum(),
						},
						{
							Name:   stringPtr("ModelPath"),
							Number: int32Ptr(59),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
						{
							Name:   stringPtr("Options"),
							Number: int32Ptr(62),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_REPEATED.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
						{
							Name:     stringPtr("components"),
							Number:   int32Ptr(63),
							Label:    descriptorpb.FieldDescriptorProto_LABEL_REPEATED.Enum(),
							Type:     descriptorpb.FieldDescriptorProto_TYPE_MESSAGE.Enum(),
							TypeName: stringPtr(".backend.ComponentBinding"),
						},
					},
				},
				{
					Name: stringPtr("GenerateImageRequest"),
					Field: []*descriptorpb.FieldDescriptorProto{
						{
							Name:   stringPtr("height"),
							Number: int32Ptr(1),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum(),
						},
						{
							Name:   stringPtr("width"),
							Number: int32Ptr(2),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum(),
						},
						{
							Name:   stringPtr("step"),
							Number: int32Ptr(4),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum(),
						},
						{
							Name:   stringPtr("seed"),
							Number: int32Ptr(5),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum(),
						},
						{
							Name:   stringPtr("positive_prompt"),
							Number: int32Ptr(6),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
						{
							Name:   stringPtr("negative_prompt"),
							Number: int32Ptr(7),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
						{
							Name:   stringPtr("dst"),
							Number: int32Ptr(8),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
						{
							Name:   stringPtr("src"),
							Number: int32Ptr(9),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
						{
							Name:   stringPtr("EnableParameters"),
							Number: int32Ptr(10),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
						{
							Name:   stringPtr("ref_images"),
							Number: int32Ptr(12),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_REPEATED.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
					},
				},
				{
					Name: stringPtr("GenerateImageEvent"),
					Field: []*descriptorpb.FieldDescriptorProto{
						{
							Name:   stringPtr("current_step"),
							Number: int32Ptr(1),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum(),
						},
						{
							Name:   stringPtr("total_steps"),
							Number: int32Ptr(2),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum(),
						},
						{
							Name:   stringPtr("progress_percent"),
							Number: int32Ptr(3),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum(),
						},
						{
							Name:   stringPtr("done"),
							Number: int32Ptr(4),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum(),
						},
						{
							Name:   stringPtr("success"),
							Number: int32Ptr(5),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum(),
						},
						{
							Name:   stringPtr("message"),
							Number: int32Ptr(6),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
						},
						{
							Name:   stringPtr("queue_wait_ms"),
							Number: int32Ptr(7),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_INT64.Enum(),
						},
						{
							Name:   stringPtr("generate_duration_ms"),
							Number: int32Ptr(8),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_INT64.Enum(),
						},
						{
							Name:   stringPtr("queue_serialized"),
							Number: int32Ptr(9),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum(),
						},
						{
							Name:   stringPtr("resident_reused"),
							Number: int32Ptr(10),
							Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
							Type:   descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum(),
						},
					},
				},
			},
			Service: []*descriptorpb.ServiceDescriptorProto{
				{
					Name: stringPtr("Backend"),
					Method: []*descriptorpb.MethodDescriptorProto{
						{
							Name:       stringPtr("LoadModel"),
							InputType:  stringPtr(".backend.ModelOptions"),
							OutputType: stringPtr(".backend.Result"),
						},
						{
							Name:            stringPtr("GenerateImage"),
							InputType:       stringPtr(".backend.GenerateImageRequest"),
							OutputType:      stringPtr(".backend.GenerateImageEvent"),
							ServerStreaming: descriptorBoolPtr(true),
						},
						{
							Name:       stringPtr("Free"),
							InputType:  stringPtr(".backend.ModelOptions"),
							OutputType: stringPtr(".backend.Result"),
						},
					},
				},
			},
		}), nil)
		if err != nil {
			descriptorErr = fmt.Errorf("build local backend descriptors: %w", err)
			return
		}

		resultMessageDescriptor = fileDescriptor.Messages().ByName("Result")
		modelOptionsMessageDescriptor = fileDescriptor.Messages().ByName("ModelOptions")
		componentBindingMessageDescriptor = fileDescriptor.Messages().ByName("ComponentBinding")
		generateImageMessageDescriptor = fileDescriptor.Messages().ByName("GenerateImageRequest")
		generateImageEventDescriptor = fileDescriptor.Messages().ByName("GenerateImageEvent")
		if resultMessageDescriptor == nil || modelOptionsMessageDescriptor == nil || componentBindingMessageDescriptor == nil || generateImageMessageDescriptor == nil || generateImageEventDescriptor == nil {
			descriptorErr = fmt.Errorf("resolve local backend message descriptors")
		}
	})
	return descriptorErr
}

func setStringField(message *dynamicpb.Message, fieldName string, value string) {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || strings.TrimSpace(value) == "" {
		return
	}
	message.Set(field, protoreflect.ValueOfString(value))
}

func setInt32Field(message *dynamicpb.Message, fieldName string, value int32) {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || value == 0 {
		return
	}
	message.Set(field, protoreflect.ValueOfInt32(value))
}

func setFloatField(message *dynamicpb.Message, fieldName string, value float32) {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || value == 0 {
		return
	}
	message.Set(field, protoreflect.ValueOfFloat32(value))
}

func setBoolField(message *dynamicpb.Message, fieldName string, value bool) {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !value {
		return
	}
	message.Set(field, protoreflect.ValueOfBool(value))
}

func setRepeatedStringField(message *dynamicpb.Message, fieldName string, values []string) {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || len(values) == 0 {
		return
	}
	list := message.Mutable(field).List()
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		list.Append(protoreflect.ValueOfString(trimmed))
	}
}

func setRepeatedComponentBindingField(message *dynamicpb.Message, values []ComponentBinding) {
	if message == nil || len(values) == 0 || componentBindingMessageDescriptor == nil {
		return
	}
	field := message.Descriptor().Fields().ByName(protoreflect.Name("components"))
	if field == nil {
		return
	}
	list := message.Mutable(field).List()
	for _, value := range values {
		component := dynamicpb.NewMessage(componentBindingMessageDescriptor)
		setStringField(component, "occurrence_id", value.OccurrenceID)
		setInt32Field(component, "order", value.Order)
		setStringField(component, "role", value.Role)
		setStringField(component, "component_kind", value.ComponentKind)
		setStringField(component, "engine_slot", value.EngineSlot)
		setStringField(component, "path", value.Path)
		setBoolField(component, "required", value.Required)
		setStringField(component, "weight", value.Weight)
		setStringField(component, "options_json", value.OptionsJSON)
		list.Append(protoreflect.ValueOfMessage(component))
	}
}

func readResult(message *dynamicpb.Message) (bool, string, *LoadModelDiagnostics) {
	if message == nil {
		return false, "", nil
	}
	successField := message.Descriptor().Fields().ByName(protoreflect.Name("success"))
	messageField := message.Descriptor().Fields().ByName(protoreflect.Name("message"))
	success := false
	resultMessage := ""
	if successField != nil && message.Has(successField) {
		success = message.Get(successField).Bool()
	}
	if messageField != nil && message.Has(messageField) {
		resultMessage = message.Get(messageField).String()
	}
	return success, strings.TrimSpace(resultMessage), &LoadModelDiagnostics{
		CacheHit:          readOptionalBoolField(message, "cache_hit"),
		ResidentReused:    readOptionalBoolField(message, "resident_reused"),
		ResidentRestarted: readOptionalBoolField(message, "resident_restarted"),
	}
}

func readGenerateImageEvent(message *dynamicpb.Message) (ImageGenerateProgress, bool, bool, bool, string, *ImageGenerateDiagnostics) {
	if message == nil {
		return ImageGenerateProgress{}, false, false, false, "", nil
	}
	progress := ImageGenerateProgress{
		CurrentStep:     readOptionalInt32Field(message, "current_step"),
		TotalSteps:      readOptionalInt32Field(message, "total_steps"),
		ProgressPercent: readOptionalInt32Field(message, "progress_percent"),
	}
	hasProgress := progress.CurrentStep > 0 || progress.TotalSteps > 0 || progress.ProgressPercent > 0
	return progress, hasProgress, readOptionalBoolField(message, "done"), readOptionalBoolField(message, "success"), readOptionalStringField(message, "message"), &ImageGenerateDiagnostics{
		QueueWaitMs:        readOptionalInt64Field(message, "queue_wait_ms"),
		GenerateDurationMs: readOptionalInt64Field(message, "generate_duration_ms"),
		QueueSerialized:    readOptionalBoolField(message, "queue_serialized"),
		ResidentReused:     readOptionalBoolField(message, "resident_reused"),
	}
}

func isGenerateResultTerminalCandidate(progress ImageGenerateProgress, done bool, success bool, message string, diag *ImageGenerateDiagnostics) bool {
	if done || success || strings.TrimSpace(message) != "" || diag == nil {
		return false
	}
	if progress.CurrentStep != 0 || progress.ProgressPercent != 0 || progress.TotalSteps != 1 {
		return false
	}
	return diag.QueueWaitMs == 0 &&
		diag.GenerateDurationMs == 0 &&
		!diag.QueueSerialized &&
		!diag.ResidentReused
}

func requireGeneratedImageArtifact(path string) error {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return fmt.Errorf("destination path is empty")
	}
	info, err := os.Stat(trimmed)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("destination is a directory")
	}
	if info.Size() <= 0 {
		return fmt.Errorf("destination file is empty")
	}
	return nil
}

func defaultMessage(value string, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(fallback)
}

func readOptionalStringField(message *dynamicpb.Message, fieldName string) string {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return ""
	}
	return strings.TrimSpace(message.Get(field).String())
}

func readOptionalInt32Field(message *dynamicpb.Message, fieldName string) int32 {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return 0
	}
	return int32(message.Get(field).Int())
}

func readOptionalInt64Field(message *dynamicpb.Message, fieldName string) int64 {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return 0
	}
	return message.Get(field).Int()
}

func readOptionalBoolField(message *dynamicpb.Message, fieldName string) bool {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return false
	}
	return message.Get(field).Bool()
}

func hasOptionalField(message *dynamicpb.Message, fieldName string) bool {
	if message == nil {
		return false
	}
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	return field != nil && message.Has(field)
}

func stringPtr(value string) *string {
	return &value
}

func int32Ptr(value int32) *int32 {
	return &value
}

func descriptorBoolPtr(value bool) *bool {
	return &value
}
