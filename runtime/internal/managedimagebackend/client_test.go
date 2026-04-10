package managedimagebackend

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

func TestLoadModelAndGenerateImage(t *testing.T) {
	if err := ensureDescriptors(); err != nil {
		t.Fatalf("ensureDescriptors: %v", err)
	}

	tempDir := t.TempDir()
	outputPath := filepath.Join(tempDir, "artifact.png")
	modelsRoot := filepath.Join(tempDir, "models")
	if err := os.MkdirAll(modelsRoot, 0o755); err != nil {
		t.Fatalf("mkdir models root: %v", err)
	}

	var (
		loadModelPath string
		loadModelFile string
		loadOptions   []string
		generateDst   string
		generateSrc   string
		enableParams  string
		progresses    []ImageGenerateProgress
	)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	server := grpc.NewServer(grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		method, _ := grpc.MethodFromServerStream(stream)
		switch method {
		case backendLoadModelMethod:
			in := dynamicpb.NewMessage(modelOptionsMessageDescriptor)
			if err := stream.RecvMsg(in); err != nil {
				return err
			}
			loadModelPath = readStringField(in, "ModelPath")
			loadModelFile = readStringField(in, "ModelFile")
			loadOptions = readRepeatedStringField(in, "Options")
			return stream.SendMsg(successResult("loaded"))
		case backendGenerateImageMethod:
			in := dynamicpb.NewMessage(generateImageMessageDescriptor)
			if err := stream.RecvMsg(in); err != nil {
				return err
			}
			generateDst = readStringField(in, "dst")
			generateSrc = readStringField(in, "src")
			enableParams = readStringField(in, "EnableParameters")
			if err := os.WriteFile(generateDst, []byte("png"), 0o600); err != nil {
				return err
			}
			if err := stream.SendMsg(progressEvent(4, 8, 50)); err != nil {
				return err
			}
			return stream.SendMsg(generateTerminalEvent(true, "generated"))
		default:
			return status.Error(codes.Unimplemented, method)
		}
	}))
	defer server.Stop()

	go func() {
		_ = server.Serve(listener)
	}()

	err = LoadModelAndGenerateImage(context.Background(), ImageRequest{
		BackendAddress: listener.Addr().String(),
		ModelsRoot:     modelsRoot,
		ModelPath:      "resolved/example/model.gguf",
		Options:        []string{"diffusion_model", "vae_path:resolved/example/vae.safetensors"},
		Width:          1024,
		Height:         1024,
		Step:           25,
		PositivePrompt: "orange cat",
		NegativePrompt: "blurry",
		EnableParams:   "mask:/tmp/mask.png",
		Dst:            outputPath,
		Src:            "/tmp/source.png",
		OnProgress: func(progress ImageGenerateProgress) {
			progresses = append(progresses, progress)
		},
	})
	if err != nil {
		t.Fatalf("LoadModelAndGenerateImage: %v", err)
	}
	if loadModelPath != modelsRoot {
		t.Fatalf("load model path mismatch: got=%q want=%q", loadModelPath, modelsRoot)
	}
	if loadModelFile != "resolved/example/model.gguf" {
		t.Fatalf("load model file mismatch: %q", loadModelFile)
	}
	if len(loadOptions) != 2 || loadOptions[1] != "vae_path:resolved/example/vae.safetensors" {
		t.Fatalf("load options mismatch: %+v", loadOptions)
	}
	if generateDst != outputPath {
		t.Fatalf("generate dst mismatch: got=%q want=%q", generateDst, outputPath)
	}
	if generateSrc != "/tmp/source.png" {
		t.Fatalf("generate src mismatch: %q", generateSrc)
	}
	if enableParams != "mask:/tmp/mask.png" {
		t.Fatalf("enable params mismatch: %q", enableParams)
	}
	if len(progresses) != 1 {
		t.Fatalf("expected one progress callback, got %d", len(progresses))
	}
	if progresses[0].CurrentStep != 4 || progresses[0].TotalSteps != 8 || progresses[0].ProgressPercent != 50 {
		t.Fatalf("unexpected progress callback: %+v", progresses[0])
	}
	payload, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("read generated output: %v", err)
	}
	if string(payload) != "png" {
		t.Fatalf("generated payload mismatch: %q", string(payload))
	}
}

func TestLoadModelAndGenerateImageReturnsBackendFailure(t *testing.T) {
	if err := ensureDescriptors(); err != nil {
		t.Fatalf("ensureDescriptors: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	server := grpc.NewServer(grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		method, _ := grpc.MethodFromServerStream(stream)
		if method != backendLoadModelMethod {
			return status.Error(codes.Unimplemented, method)
		}
		in := dynamicpb.NewMessage(modelOptionsMessageDescriptor)
		if err := stream.RecvMsg(in); err != nil {
			return err
		}
		return stream.SendMsg(failureResult("load failed"))
	}))
	defer server.Stop()

	go func() {
		_ = server.Serve(listener)
	}()

	err = LoadModelAndGenerateImage(context.Background(), ImageRequest{
		BackendAddress: listener.Addr().String(),
		ModelsRoot:     t.TempDir(),
		ModelPath:      "resolved/example/model.gguf",
		Dst:            filepath.Join(t.TempDir(), "artifact.png"),
	})
	if err == nil || !strings.Contains(err.Error(), "load failed") {
		t.Fatalf("expected backend load failure, got %v", err)
	}
}

func TestFreeModelInvokesBackendFree(t *testing.T) {
	if err := ensureDescriptors(); err != nil {
		t.Fatalf("ensureDescriptors: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	var (
		freeModelPath string
		freeModelFile string
	)

	server := grpc.NewServer(grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		method, _ := grpc.MethodFromServerStream(stream)
		if method != backendFreeModelMethod {
			return status.Error(codes.Unimplemented, method)
		}
		in := dynamicpb.NewMessage(modelOptionsMessageDescriptor)
		if err := stream.RecvMsg(in); err != nil {
			return err
		}
		freeModelPath = readStringField(in, "ModelPath")
		freeModelFile = readStringField(in, "ModelFile")
		return stream.SendMsg(successResult("freed"))
	}))
	defer server.Stop()

	go func() {
		_ = server.Serve(listener)
	}()

	err = FreeModel(context.Background(), LoadModelRequest{
		BackendAddress: listener.Addr().String(),
		ModelsRoot:     "/tmp/models",
		ModelPath:      "resolved/example/model.gguf",
	})
	if err != nil {
		t.Fatalf("FreeModel: %v", err)
	}
	if freeModelPath != "/tmp/models" {
		t.Fatalf("free model path mismatch: got=%q", freeModelPath)
	}
	if freeModelFile != "resolved/example/model.gguf" {
		t.Fatalf("free model file mismatch: got=%q", freeModelFile)
	}
}

func successResult(message string) *dynamicpb.Message {
	result := dynamicpb.NewMessage(resultMessageDescriptor)
	setStringField(result, "message", message)
	result.Set(resultMessageDescriptor.Fields().ByName(protoreflect.Name("success")), protoreflect.ValueOfBool(true))
	return result
}

func failureResult(message string) *dynamicpb.Message {
	result := dynamicpb.NewMessage(resultMessageDescriptor)
	setStringField(result, "message", message)
	result.Set(resultMessageDescriptor.Fields().ByName(protoreflect.Name("success")), protoreflect.ValueOfBool(false))
	return result
}

func progressEvent(currentStep int32, totalSteps int32, progressPercent int32) *dynamicpb.Message {
	event := dynamicpb.NewMessage(generateImageEventDescriptor)
	event.Set(generateImageEventDescriptor.Fields().ByName(protoreflect.Name("current_step")), protoreflect.ValueOfInt32(currentStep))
	event.Set(generateImageEventDescriptor.Fields().ByName(protoreflect.Name("total_steps")), protoreflect.ValueOfInt32(totalSteps))
	event.Set(generateImageEventDescriptor.Fields().ByName(protoreflect.Name("progress_percent")), protoreflect.ValueOfInt32(progressPercent))
	event.Set(generateImageEventDescriptor.Fields().ByName(protoreflect.Name("done")), protoreflect.ValueOfBool(false))
	event.Set(generateImageEventDescriptor.Fields().ByName(protoreflect.Name("success")), protoreflect.ValueOfBool(true))
	return event
}

func generateTerminalEvent(success bool, message string) *dynamicpb.Message {
	event := dynamicpb.NewMessage(generateImageEventDescriptor)
	event.Set(generateImageEventDescriptor.Fields().ByName(protoreflect.Name("done")), protoreflect.ValueOfBool(true))
	event.Set(generateImageEventDescriptor.Fields().ByName(protoreflect.Name("success")), protoreflect.ValueOfBool(success))
	setStringField(event, "message", message)
	return event
}

func readStringField(message *dynamicpb.Message, fieldName string) string {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return ""
	}
	return message.Get(field).String()
}

func readRepeatedStringField(message *dynamicpb.Message, fieldName string) []string {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return nil
	}
	list := message.Get(field).List()
	out := make([]string, 0, list.Len())
	for index := 0; index < list.Len(); index++ {
		out = append(out, list.Get(index).String())
	}
	return out
}
