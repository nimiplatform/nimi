package main

import (
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"os"
	"strings"
	"time"
)

func runRuntimeAIImage(args []string) error {
	return runRuntimeAIArtifact(args, runtimeAIArtifactModeImage)
}

func runRuntimeAIVideo(args []string) error {
	return runRuntimeAIArtifact(args, runtimeAIArtifactModeVideo)
}

func runRuntimeAITTS(args []string) error {
	return runRuntimeAIArtifact(args, runtimeAIArtifactModeTTS)
}

func runRuntimeAISTT(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi ai stt", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "15s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	modelID := fs.String("model-id", "local/whisper-1", "target model id")
	routeRaw := fs.String("route", "local", "route policy: local|cloud")
	fallbackRaw := fs.String("fallback", "deny", "fallback policy: deny|allow")
	timeoutMS := fs.Int("timeout-ms", 90000, "ai request timeout in milliseconds")
	audioPath := fs.String("audio-file", "", "audio file path")
	mimeType := fs.String("mime-type", "audio/wav", "audio mime type")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if strings.TrimSpace(*audioPath) == "" {
		return fmt.Errorf("audio-file is required")
	}
	if strings.TrimSpace(*mimeType) == "" {
		return fmt.Errorf("mime-type is required")
	}
	if *timeoutMS <= 0 {
		return fmt.Errorf("timeout-ms must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	routePolicy, err := parseRoutePolicy(*routeRaw)
	if err != nil {
		return err
	}
	fallbackPolicy, err := parseFallbackPolicy(*fallbackRaw)
	if err != nil {
		return err
	}
	audioBytes, err := os.ReadFile(strings.TrimSpace(*audioPath))
	if err != nil {
		return fmt.Errorf("read audio-file: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)

	artifact, err := entrypoint.SubmitMediaJobAndCollectGRPC(*grpcAddr, timeout, &runtimev1.SubmitMediaJobRequest{
		AppId:         strings.TrimSpace(*appID),
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		ModelId:       strings.TrimSpace(*modelID),
		Modal:         runtimev1.Modal_MODAL_STT,
		RoutePolicy:   routePolicy,
		Fallback:      fallbackPolicy,
		TimeoutMs:     int32(*timeoutMS),
		Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioBytes: audioBytes,
				MimeType:   strings.TrimSpace(*mimeType),
			},
		},
	}, callerMeta)
	if err != nil {
		return err
	}
	text := strings.TrimSpace(string(artifact.Payload))

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"text":           text,
			"route_decision": artifact.RouteDecision.String(),
			"model_resolved": artifact.ModelResolved,
			"trace_id":       artifact.TraceID,
			"usage": map[string]any{
				"input_tokens":  artifact.Usage.GetInputTokens(),
				"output_tokens": artifact.Usage.GetOutputTokens(),
				"compute_ms":    artifact.Usage.GetComputeMs(),
			},
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Println(text)
	fmt.Printf("trace=%s model=%s route=%s usage(in=%d,out=%d,ms=%d)\n",
		artifact.TraceID,
		artifact.ModelResolved,
		artifact.RouteDecision.String(),
		artifact.Usage.GetInputTokens(),
		artifact.Usage.GetOutputTokens(),
		artifact.Usage.GetComputeMs(),
	)
	return nil
}

type runtimeAIArtifactMode string

const (
	runtimeAIArtifactModeImage runtimeAIArtifactMode = "image"
	runtimeAIArtifactModeVideo runtimeAIArtifactMode = "video"
	runtimeAIArtifactModeTTS   runtimeAIArtifactMode = "tts"
)

func runRuntimeAIArtifact(args []string, mode runtimeAIArtifactMode) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	command := "nimi ai " + string(mode)
	fs := flag.NewFlagSet(command, flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", defaultRuntimeAIArtifactTimeout(mode), "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	modelID := fs.String("model-id", defaultRuntimeAIArtifactModel(mode), "target model id")
	routeRaw := fs.String("route", "local", "route policy: local|cloud")
	fallbackRaw := fs.String("fallback", "deny", "fallback policy: deny|allow")
	timeoutMS := fs.Int("timeout-ms", defaultRuntimeAIArtifactTimeoutMs(mode), "ai request timeout in milliseconds")
	outputPath := fs.String("output", "", "artifact output file path")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")

	var textValue *string
	switch mode {
	case runtimeAIArtifactModeTTS:
		textValue = fs.String("text", "", "speech text")
	default:
		textValue = fs.String("prompt", "", "prompt text")
	}
	if err := fs.Parse(args); err != nil {
		return err
	}

	content := strings.TrimSpace(*textValue)
	if content == "" {
		if mode == runtimeAIArtifactModeTTS {
			return fmt.Errorf("text is required")
		}
		return fmt.Errorf("prompt is required")
	}
	if *timeoutMS <= 0 {
		return fmt.Errorf("timeout-ms must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	routePolicy, err := parseRoutePolicy(*routeRaw)
	if err != nil {
		return err
	}
	fallbackPolicy, err := parseFallbackPolicy(*fallbackRaw)
	if err != nil {
		return err
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)

	submitReq := &runtimev1.SubmitMediaJobRequest{
		AppId:         strings.TrimSpace(*appID),
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		ModelId:       strings.TrimSpace(*modelID),
		RoutePolicy:   routePolicy,
		Fallback:      fallbackPolicy,
		TimeoutMs:     int32(*timeoutMS),
	}
	switch mode {
	case runtimeAIArtifactModeImage:
		submitReq.Modal = runtimev1.Modal_MODAL_IMAGE
		submitReq.Spec = &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: content,
			},
		}
	case runtimeAIArtifactModeVideo:
		submitReq.Modal = runtimev1.Modal_MODAL_VIDEO
		submitReq.Spec = &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: content,
			},
		}
	case runtimeAIArtifactModeTTS:
		submitReq.Modal = runtimev1.Modal_MODAL_TTS
		submitReq.Spec = &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: content,
			},
		}
	default:
		return fmt.Errorf("unsupported mode %q", mode)
	}
	artifact, err := entrypoint.SubmitMediaJobAndCollectGRPC(*grpcAddr, timeout, submitReq, callerMeta)
	if err != nil {
		return err
	}

	if path := strings.TrimSpace(*outputPath); path != "" {
		if err := os.WriteFile(path, artifact.Payload, 0o644); err != nil {
			return fmt.Errorf("write artifact output: %w", err)
		}
	}

	if *jsonOutput {
		payload := map[string]any{
			"artifact_id":    artifact.ArtifactID,
			"mime_type":      artifact.MimeType,
			"bytes":          len(artifact.Payload),
			"route_decision": artifact.RouteDecision.String(),
			"model_resolved": artifact.ModelResolved,
			"trace_id":       artifact.TraceID,
			"output_path":    strings.TrimSpace(*outputPath),
			"usage": map[string]any{
				"input_tokens":  artifact.Usage.GetInputTokens(),
				"output_tokens": artifact.Usage.GetOutputTokens(),
				"compute_ms":    artifact.Usage.GetComputeMs(),
			},
		}
		if strings.TrimSpace(*outputPath) == "" {
			payload["artifact_base64"] = base64.StdEncoding.EncodeToString(artifact.Payload)
		}
		out, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	if strings.TrimSpace(*outputPath) == "" {
		return fmt.Errorf("output is required for %s (or use --json)", mode)
	}
	fmt.Printf("artifact_id=%s mime=%s bytes=%d output=%s trace=%s model=%s route=%s usage(in=%d,out=%d,ms=%d)\n",
		artifact.ArtifactID,
		artifact.MimeType,
		len(artifact.Payload),
		strings.TrimSpace(*outputPath),
		artifact.TraceID,
		artifact.ModelResolved,
		artifact.RouteDecision.String(),
		artifact.Usage.GetInputTokens(),
		artifact.Usage.GetOutputTokens(),
		artifact.Usage.GetComputeMs(),
	)
	return nil
}

func defaultRuntimeAIArtifactModel(mode runtimeAIArtifactMode) string {
	switch mode {
	case runtimeAIArtifactModeImage:
		return "local/sd3"
	case runtimeAIArtifactModeVideo:
		return "local/video-default"
	case runtimeAIArtifactModeTTS:
		return "local/tts-default"
	default:
		return "local/default"
	}
}

func defaultRuntimeAIArtifactTimeout(mode runtimeAIArtifactMode) string {
	switch mode {
	case runtimeAIArtifactModeImage:
		return "2m"
	case runtimeAIArtifactModeVideo:
		return "5m"
	case runtimeAIArtifactModeTTS:
		return "1m"
	default:
		return "30s"
	}
}

func defaultRuntimeAIArtifactTimeoutMs(mode runtimeAIArtifactMode) int {
	switch mode {
	case runtimeAIArtifactModeImage:
		return 120000
	case runtimeAIArtifactModeVideo:
		return 300000
	case runtimeAIArtifactModeTTS:
		return 45000
	default:
		return 30000
	}
}
