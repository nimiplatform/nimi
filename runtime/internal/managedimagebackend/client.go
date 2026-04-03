package managedimagebackend

import (
	"context"
	"fmt"
	"strings"
	"sync"

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
)

type ImageRequest struct {
	BackendAddress string
	ModelsRoot     string
	ModelPath      string
	Options        []string
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
}

type LoadModelRequest struct {
	BackendAddress string
	ModelsRoot     string
	ModelPath      string
	Options        []string
	CFGScale       float32
	Threads        int32
}

var (
	descriptorOnce sync.Once
	descriptorErr  error

	resultMessageDescriptor        protoreflect.MessageDescriptor
	modelOptionsMessageDescriptor  protoreflect.MessageDescriptor
	generateImageMessageDescriptor protoreflect.MessageDescriptor
)

func LoadModelAndGenerateImage(ctx context.Context, req ImageRequest) error {
	if strings.TrimSpace(req.Dst) == "" {
		return fmt.Errorf("managed media destination is required")
	}
	if err := LoadModel(ctx, LoadModelRequest{
		BackendAddress: req.BackendAddress,
		ModelsRoot:     req.ModelsRoot,
		ModelPath:      req.ModelPath,
		Options:        req.Options,
		CFGScale:       req.CFGScale,
		Threads:        req.Threads,
	}); err != nil {
		return err
	}
	return GenerateImage(ctx, req)
}

func GenerateImage(ctx context.Context, req ImageRequest) error {
	if strings.TrimSpace(req.Dst) == "" {
		return fmt.Errorf("managed media destination is required")
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
	defer conn.Close()

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

	generateResp := dynamicpb.NewMessage(resultMessageDescriptor)
	if err := conn.Invoke(ctx, backendGenerateImageMethod, generateReq, generateResp); err != nil {
		return fmt.Errorf("generate managed media image: %w", err)
	}
	if success, message := readResult(generateResp); !success {
		return fmt.Errorf("generate managed media image failed: %s", defaultMessage(message, "backend returned unsuccessful image result"))
	}
	return nil
}

func LoadModel(ctx context.Context, req LoadModelRequest) error {
	if strings.TrimSpace(req.BackendAddress) == "" {
		return fmt.Errorf("local backend address is required")
	}
	if strings.TrimSpace(req.ModelsRoot) == "" {
		return fmt.Errorf("local models root is required")
	}
	if strings.TrimSpace(req.ModelPath) == "" {
		return fmt.Errorf("managed media model path is required")
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
	defer conn.Close()

	loadReq := dynamicpb.NewMessage(modelOptionsMessageDescriptor)
	setStringField(loadReq, "ModelPath", req.ModelsRoot)
	setStringField(loadReq, "ModelFile", req.ModelPath)
	setInt32Field(loadReq, "Threads", req.Threads)
	setFloatField(loadReq, "CFGScale", req.CFGScale)
	setRepeatedStringField(loadReq, "Options", req.Options)

	loadResp := dynamicpb.NewMessage(resultMessageDescriptor)
	if err := conn.Invoke(ctx, backendLoadModelMethod, loadReq, loadResp); err != nil {
		return fmt.Errorf("load managed media model: %w", err)
	}
	if success, message := readResult(loadResp); !success {
		return fmt.Errorf("load managed media model failed: %s", defaultMessage(message, "backend returned unsuccessful load result"))
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
							Name:       stringPtr("GenerateImage"),
							InputType:  stringPtr(".backend.GenerateImageRequest"),
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
		generateImageMessageDescriptor = fileDescriptor.Messages().ByName("GenerateImageRequest")
		if resultMessageDescriptor == nil || modelOptionsMessageDescriptor == nil || generateImageMessageDescriptor == nil {
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

func readResult(message *dynamicpb.Message) (bool, string) {
	if message == nil {
		return false, ""
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
	return success, strings.TrimSpace(resultMessage)
}

func defaultMessage(value string, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(fallback)
}

func stringPtr(value string) *string {
	return &value
}

func int32Ptr(value int32) *int32 {
	return &value
}
