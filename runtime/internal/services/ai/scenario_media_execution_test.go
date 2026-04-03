package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

type fakeLocalImageProfileResolver struct {
	alias               string
	profile             map[string]any
	forwardedExtensions map[string]any
	modelsRoot          string
	backendAddress      string
	selection           engine.ImageSupervisedMatrixSelection
	executionHealthy    bool
	executionDetail     string
	ensureLoadCalls     int
	releaseCalls        int
	lastLoadReason      string
	lastReleaseReason   string
	resolveProfileCalls int
	resolveProfileErr   error
	lastRequestedModel  string
	lastExtensions      map[string]any
}

func (f *fakeLocalImageProfileResolver) ResolveManagedMediaImageProfile(_ context.Context, requestedModelID string, scenarioExtensions map[string]any) (string, map[string]any, map[string]any, error) {
	f.resolveProfileCalls++
	f.lastRequestedModel = requestedModelID
	f.lastExtensions = scenarioExtensions
	if f.resolveProfileErr != nil {
		return "", nil, nil, f.resolveProfileErr
	}
	return f.alias, f.profile, f.forwardedExtensions, nil
}

func (f *fakeLocalImageProfileResolver) ResolveManagedAssetPath(_ context.Context, _ string) (string, error) {
	return "", nil
}

func (f *fakeLocalImageProfileResolver) ResolveManagedMediaBackendTarget(_ context.Context) (string, string, error) {
	return f.modelsRoot, f.backendAddress, nil
}

func (f *fakeLocalImageProfileResolver) ResolveCanonicalImageSelection(_ context.Context, _ string) (engine.ImageSupervisedMatrixSelection, error) {
	return f.selection, nil
}

func (f *fakeLocalImageProfileResolver) EnsureManagedMediaImageLoaded(_ context.Context, requestedModelID string, profile map[string]any, loadReason string) error {
	f.ensureLoadCalls++
	f.lastRequestedModel = requestedModelID
	f.lastLoadReason = loadReason
	f.profile = profile
	return nil
}

func (f *fakeLocalImageProfileResolver) ReleaseManagedMediaImage(_ context.Context, requestedModelID string, profile map[string]any, releaseReason string) error {
	f.releaseCalls++
	f.lastRequestedModel = requestedModelID
	f.lastReleaseReason = releaseReason
	f.profile = profile
	return nil
}

func (f *fakeLocalImageProfileResolver) UpdateManagedMediaImageExecutionStatus(_ context.Context, _ string, healthy bool, detail string) error {
	f.executionHealthy = healthy
	f.executionDetail = detail
	return nil
}

func TestExecuteBackendSyncMediaImageUsesManagedPathWhenProfileResolverReturnsManagedModel(t *testing.T) {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()
	tempDir := t.TempDir()
	server := grpc.NewServer(grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		method, _ := grpc.MethodFromServerStream(stream)
		switch method {
		case "/backend.Backend/GenerateImage":
			in := dynamicpb.NewMessage(getManagedImageDescriptor(t, "GenerateImageRequest"))
			if err := stream.RecvMsg(in); err != nil {
				return err
			}
			dst := readManagedImageStringField(in, "dst")
			if err := os.WriteFile(dst, []byte("png"), 0o600); err != nil {
				return err
			}
			return stream.SendMsg(managedImageSuccessResult(t, "generated"))
		default:
			return status.Error(codes.Unimplemented, method)
		}
	}))
	defer server.Stop()
	go func() {
		_ = server.Serve(listener)
	}()

	resolver := &fakeLocalImageProfileResolver{
		alias: "managed-image-alias",
		profile: map[string]any{
			"backend": "stablediffusion-ggml",
			"parameters": map[string]any{
				"model": "resolved/example/model.gguf",
			},
		},
		forwardedExtensions: map[string]any{
			"step": 25,
		},
		modelsRoot:     tempDir,
		backendAddress: listener.Addr().String(),
		selection: engine.ImageSupervisedMatrixSelection{
			Matched:        true,
			EntryID:        "linux-x64-nvidia-gguf",
			ProductState:   engine.ImageProductStateSupported,
			BackendClass:   engine.ImageBackendClassNativeBinary,
			BackendFamily:  engine.ImageBackendFamilyStableDiffusionGGML,
			ControlPlane:   engine.ImageControlPlaneRuntime,
			ExecutionPlane: engine.EngineMedia,
			Entry: &engine.ImageSupervisedMatrixEntry{
				EntryID:        "linux-x64-nvidia-gguf",
				ProductState:   engine.ImageProductStateSupported,
				BackendClass:   engine.ImageBackendClassNativeBinary,
				BackendFamily:  engine.ImageBackendFamilyStableDiffusionGGML,
				ControlPlane:   engine.ImageControlPlaneRuntime,
				ExecutionPlane: engine.EngineMedia,
			},
		},
	}
	svc := &Service{
		localImageProfile: resolver,
	}
	selectedProvider := &localProvider{
		media: nimillm.NewBackend("local-media", "http://127.0.0.1:1", "", 0),
	}
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			ModelId: "local-import/z_image_turbo-Q4_K",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt: "orange cat",
					N:      1,
					Size:   "1024x1024",
				},
			},
		},
	}

	artifacts, _, _, err := executeBackendSyncMedia(
		context.Background(),
		svc,
		nil,
		req,
		selectedProvider,
		"media/local-import/z_image_turbo-Q4_K",
		adapterMediaNative,
		nil,
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("executeBackendSyncMedia: %v", err)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected one artifact, got %d", len(artifacts))
	}
	if resolver.ensureLoadCalls != 1 {
		t.Fatalf("expected exactly one managed image preload, got %d", resolver.ensureLoadCalls)
	}
	if resolver.releaseCalls != 1 {
		t.Fatalf("expected exactly one managed image release, got %d", resolver.releaseCalls)
	}
	if resolver.lastLoadReason != "generate_request" {
		t.Fatalf("expected generate load reason, got %q", resolver.lastLoadReason)
	}
	if resolver.lastReleaseReason != "generate_request_cleanup" {
		t.Fatalf("expected generate release reason, got %q", resolver.lastReleaseReason)
	}
	if !resolver.executionHealthy {
		t.Fatalf("expected successful execution status callback, detail=%q", resolver.executionDetail)
	}
}

func TestExecuteBackendSyncMediaImageUsesPlainPathForPythonPipelineSelection(t *testing.T) {
	t.Helper()

	var (
		importCalled    bool
		generateModelID string
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/models/import":
			importCalled = true
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
			})
		case "/v1/media/image/generate":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode image request: %v", err)
			}
			generateModelID, _ = payload["model"].(string)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"artifact": map[string]any{
					"mime_type":   "image/png",
					"data_base64": base64.StdEncoding.EncodeToString([]byte("png")),
				},
			})
		default:
			t.Fatalf("unexpected request path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	svc := &Service{
		localImageProfile: &fakeLocalImageProfileResolver{
			selection: engine.ImageSupervisedMatrixSelection{
				Matched:        true,
				EntryID:        "macos-apple-silicon-workflow-safetensors",
				ProductState:   engine.ImageProductStateSupported,
				BackendClass:   engine.ImageBackendClassPythonPipeline,
				BackendFamily:  engine.ImageBackendFamilyDiffusers,
				ControlPlane:   engine.ImageControlPlaneRuntime,
				ExecutionPlane: engine.EngineMedia,
				Entry: &engine.ImageSupervisedMatrixEntry{
					EntryID:        "macos-apple-silicon-workflow-safetensors",
					ProductState:   engine.ImageProductStateSupported,
					BackendClass:   engine.ImageBackendClassPythonPipeline,
					BackendFamily:  engine.ImageBackendFamilyDiffusers,
					ControlPlane:   engine.ImageControlPlaneRuntime,
					ExecutionPlane: engine.EngineMedia,
				},
			},
		},
	}
	selectedProvider := &localProvider{
		media: nimillm.NewBackend("local-media", server.URL, "", 0),
	}
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			ModelId: "local/flux.1-schnell",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt: "orange cat",
					N:      1,
					Size:   "1024x1024",
				},
			},
		},
	}

	artifacts, _, _, err := executeBackendSyncMedia(
		context.Background(),
		svc,
		nil,
		req,
		selectedProvider,
		"media/flux.1-schnell",
		adapterMediaNative,
		nil,
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("executeBackendSyncMedia: %v", err)
	}
	if importCalled {
		t.Fatal("python pipeline path must not import managed media config")
	}
	if generateModelID != "flux.1-schnell" {
		t.Fatalf("expected original model id on plain path, got %q", generateModelID)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected one artifact, got %d", len(artifacts))
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

func managedImageSuccessResult(t *testing.T, message string) *dynamicpb.Message {
	t.Helper()
	result := dynamicpb.NewMessage(getManagedImageDescriptor(t, "Result"))
	setManagedImageStringField(result, "message", message)
	result.Set(result.Descriptor().Fields().ByName(protoreflect.Name("success")), protoreflect.ValueOfBool(true))
	return result
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

func stringPtr(value string) *string { return &value }

func int32Ptr(value int32) *int32 { return &value }

func TestExecuteBackendSyncMediaImageFailsClosedWithoutLocalImageResolver(t *testing.T) {
	t.Helper()

	selectedProvider := &localProvider{
		media: nimillm.NewBackend("local-media", "http://127.0.0.1:65535", "", 0),
	}
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			ModelId: "local-import/z_image_turbo-Q4_K",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt: "orange cat",
					N:      1,
					Size:   "1024x1024",
				},
			},
		},
	}

	_, _, _, err := executeBackendSyncMedia(
		context.Background(),
		&Service{},
		nil,
		req,
		selectedProvider,
		"media/local-import/z_image_turbo-Q4_K",
		adapterMediaNative,
		nil,
		nil,
		nil,
	)
	if err == nil {
		t.Fatal("expected canonical image execution to fail-close without resolver")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE, got err=%v reason=%v ok=%v", err, reason, ok)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T", err)
	}
	if !strings.Contains(st.Message(), "canonical image resolver unavailable") {
		t.Fatalf("expected resolver-unavailable detail, got %q", st.Message())
	}
}

func TestExecuteBackendSyncMediaImageFailsClosedForUnsupportedSelection(t *testing.T) {
	t.Helper()

	selectedProvider := &localProvider{
		media: nimillm.NewBackend("local-media", "http://127.0.0.1:65535", "", 0),
	}
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			ModelId: "local-import/z_image_turbo-Q4_K",
		},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt: "orange cat",
					N:      1,
					Size:   "1024x1024",
				},
			},
		},
	}

	_, _, _, err := executeBackendSyncMedia(
		context.Background(),
		&Service{
			localImageProfile: &fakeLocalImageProfileResolver{
				selection: engine.ImageSupervisedMatrixSelection{
					Matched:             true,
					EntryID:             "linux-x64-nvidia-workflow-safetensors",
					ProductState:        engine.ImageProductStateUnsupported,
					CompatibilityDetail: "reserved topology only",
					Entry: &engine.ImageSupervisedMatrixEntry{
						EntryID:      "linux-x64-nvidia-workflow-safetensors",
						ProductState: engine.ImageProductStateUnsupported,
					},
				},
			},
		},
		nil,
		req,
		selectedProvider,
		"media/local-import/z_image_turbo-Q4_K",
		adapterMediaNative,
		nil,
		nil,
		nil,
	)
	if err == nil {
		t.Fatal("expected unsupported canonical image selection to fail-close")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE, got err=%v reason=%v ok=%v", err, reason, ok)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T", err)
	}
	if !strings.Contains(st.Message(), "reserved topology only") {
		t.Fatalf("expected compatibility detail to surface, got %q", st.Message())
	}
}
