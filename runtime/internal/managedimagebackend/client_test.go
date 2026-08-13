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
		mask          string
		mode          string
		progresses    []ImageGenerateProgress
	)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = listener.Close() }()

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
			mask = readStringField(in, "mask")
			mode = readStringField(in, "mode")
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

	_, err = LoadModel(context.Background(), LoadModelRequest{
		BackendAddress: listener.Addr().String(),
		Protocol:       ProtocolManagedWrapper,
		ModelsRoot:     modelsRoot,
		ModelPath:      "resolved/example/model.gguf",
		Components: []ComponentBinding{
			{OccurrenceID: "vae", Role: "vae", ComponentKind: "vae", EngineSlot: "vae_path", Path: "resolved/example/vae.safetensors", Required: true},
		},
	})
	if err != nil {
		t.Fatalf("LoadModel: %v", err)
	}
	_, err = GenerateImage(context.Background(), ImageRequest{
		BackendAddress: listener.Addr().String(),
		Protocol:       ProtocolManagedWrapper,
		Mode:           ImageRequestModeImageToImage,
		ModelsRoot:     modelsRoot,
		ModelPath:      "resolved/example/model.gguf",
		Width:          1024,
		Height:         1024,
		Step:           25,
		PositivePrompt: "orange cat",
		NegativePrompt: "blurry",
		Mask:           "/tmp/mask.png",
		Dst:            outputPath,
		Src:            "/tmp/source.png",
		OnProgress: func(progress ImageGenerateProgress) error {
			progresses = append(progresses, progress)
			return nil
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
	if len(loadOptions) != 0 {
		t.Fatalf("load options mismatch: %+v", loadOptions)
	}
	if generateDst != outputPath {
		t.Fatalf("generate dst mismatch: got=%q want=%q", generateDst, outputPath)
	}
	if generateSrc != "/tmp/source.png" {
		t.Fatalf("generate src mismatch: %q", generateSrc)
	}
	if mask != "/tmp/mask.png" || mode != string(ImageRequestModeImageToImage) {
		t.Fatalf("typed request fields mismatch: mask=%q mode=%q", mask, mode)
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

func TestGenerateImageAcceptsResultTerminalShapeWhenArtifactExists(t *testing.T) {
	if err := ensureDescriptors(); err != nil {
		t.Fatalf("ensureDescriptors: %v", err)
	}

	tempDir := t.TempDir()
	outputPath := filepath.Join(tempDir, "artifact.png")

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = listener.Close() }()

	server := grpc.NewServer(grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		method, _ := grpc.MethodFromServerStream(stream)
		if method != backendGenerateImageMethod {
			return status.Error(codes.Unimplemented, method)
		}
		in := dynamicpb.NewMessage(generateImageMessageDescriptor)
		if err := stream.RecvMsg(in); err != nil {
			return err
		}
		if err := os.WriteFile(outputPath, []byte("png"), 0o600); err != nil {
			return err
		}
		return stream.SendMsg(successResult("generated"))
	}))
	defer server.Stop()

	go func() {
		_ = server.Serve(listener)
	}()

	_, err = GenerateImage(context.Background(), ImageRequest{
		BackendAddress: listener.Addr().String(),
		Protocol:       ProtocolDirectGOSD,
		Mode:           ImageRequestModeTextToImage,
		ModelPath:      "resolved/example/model.gguf",
		Dst:            outputPath,
	})
	if err != nil {
		t.Fatalf("expected Result-shaped generate terminal with artifact to pass, got %v", err)
	}
	payload, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("read generated output: %v", err)
	}
	if string(payload) != "png" {
		t.Fatalf("generated payload mismatch: %q", string(payload))
	}
}

func TestGenerateImageDirectProtocolMechanicallyLowersTypedMask(t *testing.T) {
	if err := ensureDescriptors(); err != nil {
		t.Fatal(err)
	}
	outputPath := filepath.Join(t.TempDir(), "artifact.png")
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = listener.Close() }()
	var enableParameters, wrapperMask, wrapperMode, wrapperSampler, wrapperScheduler string
	var wrapperCFGScale float32
	server := grpc.NewServer(grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		in := dynamicpb.NewMessage(generateImageMessageDescriptor)
		if err := stream.RecvMsg(in); err != nil {
			return err
		}
		enableParameters = readStringField(in, "EnableParameters")
		wrapperMask = readStringField(in, "mask")
		wrapperMode = readStringField(in, "mode")
		wrapperCFGScale = readFloatField(in, "cfg_scale")
		wrapperSampler = readStringField(in, "sampler")
		wrapperScheduler = readStringField(in, "scheduler")
		if err := os.WriteFile(outputPath, []byte("png"), 0o600); err != nil {
			return err
		}
		return stream.SendMsg(successResult("generated"))
	}))
	defer server.Stop()
	go func() { _ = server.Serve(listener) }()

	maskPath := filepath.Join(t.TempDir(), "mask.png")
	_, err = GenerateImage(context.Background(), ImageRequest{
		BackendAddress: listener.Addr().String(),
		Protocol:       ProtocolDirectGOSD,
		Mode:           ImageRequestModeImageToImage,
		Src:            filepath.Join(t.TempDir(), "source.png"),
		Mask:           maskPath,
		Dst:            outputPath,
		CFGScale:       7,
		Sampler:        "euler",
		Scheduler:      "discrete",
	})
	if err != nil {
		t.Fatal(err)
	}
	if enableParameters != "mask:"+maskPath || wrapperMask != "" || wrapperMode != "" ||
		wrapperCFGScale != 0 || wrapperSampler != "" || wrapperScheduler != "" {
		t.Fatalf("direct typed lowering leaked wrapper fields: enable=%q mask=%q mode=%q cfg=%g sampler=%q scheduler=%q", enableParameters, wrapperMask, wrapperMode, wrapperCFGScale, wrapperSampler, wrapperScheduler)
	}
}

func TestGenerateImageRejectsResultTerminalWithoutArtifact(t *testing.T) {
	if err := ensureDescriptors(); err != nil {
		t.Fatalf("ensureDescriptors: %v", err)
	}

	outputPath := filepath.Join(t.TempDir(), "artifact.png")

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = listener.Close() }()

	server := grpc.NewServer(grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		method, _ := grpc.MethodFromServerStream(stream)
		if method != backendGenerateImageMethod {
			return status.Error(codes.Unimplemented, method)
		}
		in := dynamicpb.NewMessage(generateImageMessageDescriptor)
		if err := stream.RecvMsg(in); err != nil {
			return err
		}
		return stream.SendMsg(successResult("generated"))
	}))
	defer server.Stop()

	go func() {
		_ = server.Serve(listener)
	}()

	_, err = GenerateImage(context.Background(), ImageRequest{
		BackendAddress: listener.Addr().String(),
		Protocol:       ProtocolDirectGOSD,
		Mode:           ImageRequestModeTextToImage,
		ModelPath:      "resolved/example/model.gguf",
		Dst:            outputPath,
	})
	if err == nil || !strings.Contains(err.Error(), "did not produce artifact") {
		t.Fatalf("expected Result-shaped terminal without artifact to fail closed, got %v", err)
	}
}

func TestGenerateImageRejectsResultTerminalFailureShape(t *testing.T) {
	if err := ensureDescriptors(); err != nil {
		t.Fatalf("ensureDescriptors: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = listener.Close() }()

	server := grpc.NewServer(grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		method, _ := grpc.MethodFromServerStream(stream)
		if method != backendGenerateImageMethod {
			return status.Error(codes.Unimplemented, method)
		}
		in := dynamicpb.NewMessage(generateImageMessageDescriptor)
		if err := stream.RecvMsg(in); err != nil {
			return err
		}
		return stream.SendMsg(failureResult("legacy generate failed"))
	}))
	defer server.Stop()

	go func() {
		_ = server.Serve(listener)
	}()

	_, err = GenerateImage(context.Background(), ImageRequest{
		BackendAddress: listener.Addr().String(),
		Protocol:       ProtocolDirectGOSD,
		Mode:           ImageRequestModeTextToImage,
		ModelPath:      "resolved/example/model.gguf",
		Dst:            filepath.Join(t.TempDir(), "artifact.png"),
	})
	if err == nil || !strings.Contains(err.Error(), "unknown backend event") {
		t.Fatalf("expected Result-shaped generate response to fail closed, got %v", err)
	}
}

func TestLoadModelReturnsBackendFailure(t *testing.T) {
	if err := ensureDescriptors(); err != nil {
		t.Fatalf("ensureDescriptors: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = listener.Close() }()

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

	_, err = LoadModel(context.Background(), LoadModelRequest{
		BackendAddress: listener.Addr().String(),
		Protocol:       ProtocolManagedWrapper,
		ModelsRoot:     t.TempDir(),
		ModelPath:      "resolved/example/model.gguf",
	})
	if err == nil || !strings.Contains(err.Error(), "load failed") {
		t.Fatalf("expected backend load failure, got %v", err)
	}
}

func TestLoadAndFreeRejectMixedPhysicalCarriers(t *testing.T) {
	directWithWrapper := LoadModelRequest{
		BackendAddress: "127.0.0.1:1", Protocol: ProtocolDirectGOSD,
		ModelsRoot: t.TempDir(), ModelPath: "model.gguf",
		Components: []ComponentBinding{{OccurrenceID: "vae", EngineSlot: "vae_path", Path: "vae.safetensors"}},
	}
	if _, err := LoadModel(context.Background(), directWithWrapper); err == nil || !strings.Contains(err.Error(), "managed wrapper fields") {
		t.Fatalf("mixed direct load carrier error = %v", err)
	}
	if err := FreeModel(context.Background(), directWithWrapper); err == nil || !strings.Contains(err.Error(), "managed wrapper fields") {
		t.Fatalf("mixed direct free carrier error = %v", err)
	}
	wrapperWithDirect := LoadModelRequest{
		BackendAddress: "127.0.0.1:1", Protocol: ProtocolManagedWrapper,
		ModelsRoot: t.TempDir(), ModelPath: "model.gguf", DirectOptions: []string{"diffusion_model"},
	}
	if _, err := LoadModel(context.Background(), wrapperWithDirect); err == nil || !strings.Contains(err.Error(), "direct gosd fields") {
		t.Fatalf("mixed wrapper load carrier error = %v", err)
	}
	if err := FreeModel(context.Background(), wrapperWithDirect); err == nil || !strings.Contains(err.Error(), "direct gosd fields") {
		t.Fatalf("mixed wrapper free carrier error = %v", err)
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
	defer func() { _ = listener.Close() }()

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
		Protocol:       ProtocolManagedWrapper,
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

func readFloatField(message *dynamicpb.Message, fieldName string) float32 {
	field := message.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	if field == nil || !message.Has(field) {
		return 0
	}
	return float32(message.Get(field).Float())
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
