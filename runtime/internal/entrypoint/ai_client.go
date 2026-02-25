package entrypoint

import (
	"context"
	"errors"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"strings"
	"time"
)

func GenerateTextGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.GenerateRequest, metadataOverride ...*ClientMetadata) (*runtimev1.GenerateResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("generate request is required")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, req.GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	resp, err := client.Generate(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime ai generate: %w", err)
	}
	return resp, nil
}

// EmbedGRPC calls RuntimeAiService.Embed over gRPC.
func EmbedGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.EmbedRequest, metadataOverride ...*ClientMetadata) (*runtimev1.EmbedResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("embed request is required")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, req.GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	resp, err := client.Embed(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime ai embed: %w", err)
	}
	return resp, nil
}

// TranscribeAudioGRPC calls RuntimeAiService.TranscribeAudio over gRPC.
func TranscribeAudioGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.TranscribeAudioRequest, metadataOverride ...*ClientMetadata) (*runtimev1.TranscribeAudioResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("transcribe request is required")
	}
	if timeout <= 0 {
		timeout = 15 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, req.GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	resp, err := client.TranscribeAudio(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime ai transcribe: %w", err)
	}
	return resp, nil
}

// GenerateImageGRPC calls RuntimeAiService.GenerateImage and collects chunk payload.
func GenerateImageGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.GenerateImageRequest, metadataOverride ...*ClientMetadata) (*ArtifactResult, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("generate image request is required")
	}
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, req.GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	stream, err := client.GenerateImage(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime ai generate image: %w", err)
	}
	return collectArtifactStream(stream)
}

// GenerateVideoGRPC calls RuntimeAiService.GenerateVideo and collects chunk payload.
func GenerateVideoGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.GenerateVideoRequest, metadataOverride ...*ClientMetadata) (*ArtifactResult, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("generate video request is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Minute
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, req.GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	stream, err := client.GenerateVideo(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime ai generate video: %w", err)
	}
	return collectArtifactStream(stream)
}

// SynthesizeSpeechGRPC calls RuntimeAiService.SynthesizeSpeech and collects chunk payload.
func SynthesizeSpeechGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.SynthesizeSpeechRequest, metadataOverride ...*ClientMetadata) (*ArtifactResult, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("synthesize speech request is required")
	}
	if timeout <= 0 {
		timeout = 60 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, req.GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	stream, err := client.SynthesizeSpeech(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime ai synthesize speech: %w", err)
	}
	return collectArtifactStream(stream)
}

// ListModelsGRPC calls RuntimeModelService.ListModels over gRPC.
