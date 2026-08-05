package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestExecuteBackendSyncMediaImageUsesCloudTargetWithoutLocalResolver(t *testing.T) {
	t.Helper()

	var (
		generatePath    string
		generateModelID string
		authHeader      string
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		generatePath = r.URL.Path
		if r.Method != http.MethodPost || r.URL.Path != "/v1/images/generations" {
			http.NotFound(w, r)
			return
		}
		authHeader = r.Header.Get("Authorization")
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode image request: %v", err)
		}
		generateModelID, _ = payload["model"].(string)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"b64_json": base64.StdEncoding.EncodeToString([]byte("cloud-image"))},
			},
		})
	}))
	defer func() { server.Close() }()

	cloudProvider := nimillm.NewCloudProvider(nimillm.CloudConfig{
		HTTPTimeout:           time.Second,
		AllowLoopbackEndpoint: true,
	}, nil, nil)
	remoteTarget := &nimillm.RemoteTarget{
		ProviderType:    "openai",
		Endpoint:        server.URL,
		APIKey:          "connector-key",
		ProviderModelID: "gpt-image-1.5",
		AllowLoopback:   true,
	}
	req := &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt:         "industrial future control room",
					N:              1,
					Size:           "1024x1024",
					ResponseFormat: "base64",
				},
			},
		},
	}

	artifacts, _, _, err := executeBackendSyncMedia(
		context.Background(),
		&Service{},
		nil,
		req,
		nil,
		"gpt-image-1.5",
		"openai_compat_adapter",
		remoteTarget,
		cloudProvider,
		nil,
	)
	if err != nil {
		t.Fatalf("executeBackendSyncMedia cloud image: %v", err)
	}
	if generatePath != "/v1/images/generations" {
		t.Fatalf("generate path = %q, want /v1/images/generations", generatePath)
	}
	if generateModelID != "gpt-image-1.5" {
		t.Fatalf("provider model id = %q, want gpt-image-1.5", generateModelID)
	}
	if authHeader != "Bearer connector-key" {
		t.Fatalf("authorization header = %q, want connector bearer token", authHeader)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected one cloud image artifact, got %d", len(artifacts))
	}
	if string(artifacts[0].GetBytes()) != "cloud-image" {
		t.Fatalf("artifact payload = %q, want cloud-image", string(artifacts[0].GetBytes()))
	}
	if got := metadataStringValue(artifacts[0].GetMetadata(), "adapter"); got != "openai_compat_adapter" {
		t.Fatalf("artifact adapter metadata = %q, want openai_compat_adapter", got)
	}
}

func getManagedImageDescriptor(t *testing.T, name string) protoreflect.MessageDescriptor {
	t.Helper()
	fileDescriptor, err := protodesc.NewFile((&descriptorpb.FileDescriptorProto{
		Name:    stringPtr("managed_image_test.proto"),
		Package: stringPtr("backend"),
		Syntax:  stringPtr("proto3"),
		MessageType: []*descriptorpb.DescriptorProto{
			{
				Name: stringPtr("Result"),
				Field: []*descriptorpb.FieldDescriptorProto{
					{Name: stringPtr("message"), Number: int32Ptr(1), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
					{Name: stringPtr("success"), Number: int32Ptr(2), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum()},
				},
			},
			{
				Name: stringPtr("ModelOptions"),
				Field: []*descriptorpb.FieldDescriptorProto{
					{Name: stringPtr("Threads"), Number: int32Ptr(15), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum()},
					{Name: stringPtr("ModelFile"), Number: int32Ptr(21), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
					{Name: stringPtr("CFGScale"), Number: int32Ptr(29), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_FLOAT.Enum()},
					{Name: stringPtr("ModelPath"), Number: int32Ptr(59), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
					{Name: stringPtr("Options"), Number: int32Ptr(62), Label: descriptorpb.FieldDescriptorProto_LABEL_REPEATED.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
				},
			},
			{
				Name: stringPtr("GenerateImageRequest"),
				Field: []*descriptorpb.FieldDescriptorProto{
					{Name: stringPtr("height"), Number: int32Ptr(1), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum()},
					{Name: stringPtr("width"), Number: int32Ptr(2), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum()},
					{Name: stringPtr("step"), Number: int32Ptr(4), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum()},
					{Name: stringPtr("seed"), Number: int32Ptr(5), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum()},
					{Name: stringPtr("positive_prompt"), Number: int32Ptr(6), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
					{Name: stringPtr("negative_prompt"), Number: int32Ptr(7), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
					{Name: stringPtr("dst"), Number: int32Ptr(8), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
					{Name: stringPtr("src"), Number: int32Ptr(9), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
					{Name: stringPtr("EnableParameters"), Number: int32Ptr(10), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
					{Name: stringPtr("ref_images"), Number: int32Ptr(12), Label: descriptorpb.FieldDescriptorProto_LABEL_REPEATED.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
				},
			},
			{
				Name: stringPtr("GenerateImageEvent"),
				Field: []*descriptorpb.FieldDescriptorProto{
					{Name: stringPtr("current_step"), Number: int32Ptr(1), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum()},
					{Name: stringPtr("total_steps"), Number: int32Ptr(2), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum()},
					{Name: stringPtr("progress_percent"), Number: int32Ptr(3), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum()},
					{Name: stringPtr("done"), Number: int32Ptr(4), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum()},
					{Name: stringPtr("success"), Number: int32Ptr(5), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_BOOL.Enum()},
					{Name: stringPtr("message"), Number: int32Ptr(6), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum()},
				},
			},
		},
	}), nil)
	if err != nil {
		t.Fatalf("build managed image test descriptor: %v", err)
	}
	descriptor := fileDescriptor.Messages().ByName(protoreflect.Name(name))
	if descriptor == nil {
		t.Fatalf("missing managed image descriptor %q", name)
	}
	return descriptor
}

func managedImageTerminalEvent(t *testing.T, success bool, message string) *dynamicpb.Message {
	t.Helper()
	event := dynamicpb.NewMessage(getManagedImageDescriptor(t, "GenerateImageEvent"))
	event.Set(event.Descriptor().Fields().ByName(protoreflect.Name("done")), protoreflect.ValueOfBool(true))
	event.Set(event.Descriptor().Fields().ByName(protoreflect.Name("success")), protoreflect.ValueOfBool(success))
	setManagedImageStringField(event, "message", message)
	return event
}

func readManagedImageStringField(message *dynamicpb.Message, fieldName string) string {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return ""
	}
	return message.Get(field).String()
}

func setManagedImageStringField(message *dynamicpb.Message, fieldName string, value string) {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil {
		return
	}
	message.Set(field, protoreflect.ValueOfString(value))
}

func metadataStringList(metadata *structpb.Struct, key string) []string {
	if metadata == nil {
		return nil
	}
	field := metadata.GetFields()[key]
	if field == nil || field.GetListValue() == nil {
		return nil
	}
	values := field.GetListValue().GetValues()
	out := make([]string, 0, len(values))
	for _, value := range values {
		out = append(out, value.GetStringValue())
	}
	return out
}

func metadataStringValue(metadata *structpb.Struct, key string) string {
	if metadata == nil {
		return ""
	}
	field := metadata.GetFields()[key]
	if field == nil {
		return ""
	}
	return field.GetStringValue()
}

func metadataBoolValue(metadata *structpb.Struct, key string) bool {
	if metadata == nil {
		return false
	}
	field := metadata.GetFields()[key]
	if field == nil {
		return false
	}
	return field.GetBoolValue()
}

func metadataNumberValue(metadata *structpb.Struct, key string) int64 {
	if metadata == nil {
		return 0
	}
	field := metadata.GetFields()[key]
	if field == nil {
		return 0
	}
	return int64(field.GetNumberValue())
}

func stringPtr(value string) *string { return &value }

func int32Ptr(value int32) *int32 { return &value }
