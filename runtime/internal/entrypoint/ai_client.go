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

// SubmitMediaJobAndCollectGRPC submits a media job, polls until completion, and returns the first artifact payload.
func SubmitMediaJobAndCollectGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.SubmitMediaJobRequest, metadataOverride ...*ClientMetadata) (*ArtifactResult, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("submit media job request is required")
	}
	if strings.TrimSpace(req.GetAppId()) == "" {
		return nil, errors.New("app_id is required")
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
	submitResp, err := client.SubmitMediaJob(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime ai submit media job: %w", err)
	}
	job := submitResp.GetJob()
	if job == nil || strings.TrimSpace(job.GetJobId()) == "" {
		return nil, errors.New("runtime ai submit media job returned empty job")
	}

	jobID := strings.TrimSpace(job.GetJobId())
	for {
		switch job.GetStatus() {
		case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED:
			return collectMediaArtifactResult(ctx, client, job)
		case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_QUEUED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING:
			time.Sleep(250 * time.Millisecond)
			pollResp, pollErr := client.GetMediaJob(ctx, &runtimev1.GetMediaJobRequest{
				JobId: jobID,
			})
			if pollErr != nil {
				return nil, fmt.Errorf("runtime ai get media job: %w", pollErr)
			}
			if pollResp.GetJob() == nil {
				return nil, errors.New("runtime ai get media job returned empty job")
			}
			job = pollResp.GetJob()
		default:
			reason := strings.TrimSpace(job.GetReasonDetail())
			if reason == "" {
				reason = strings.TrimSpace(job.GetReasonCode().String())
			}
			if reason == "" {
				reason = "unknown media job failure"
			}
			return nil, fmt.Errorf("runtime ai media job failed: %s", reason)
		}
	}
}

func collectMediaArtifactResult(ctx context.Context, client runtimev1.RuntimeAiServiceClient, job *runtimev1.MediaJob) (*ArtifactResult, error) {
	if job == nil || strings.TrimSpace(job.GetJobId()) == "" {
		return nil, errors.New("media job is required")
	}
	jobID := strings.TrimSpace(job.GetJobId())
	artifacts := job.GetArtifacts()
	traceID := strings.TrimSpace(job.GetTraceId())
	if len(artifacts) == 0 {
		artifactsResp, artifactsErr := client.GetMediaArtifacts(ctx, &runtimev1.GetMediaArtifactsRequest{
			JobId: jobID,
		})
		if artifactsErr != nil {
			return nil, fmt.Errorf("runtime ai get media artifacts: %w", artifactsErr)
		}
		artifacts = artifactsResp.GetArtifacts()
		if traceID == "" {
			traceID = strings.TrimSpace(artifactsResp.GetTraceId())
		}
	}
	if len(artifacts) == 0 {
		return nil, errors.New("media job completed without artifacts")
	}

	first := artifacts[0]
	return &ArtifactResult{
		ArtifactID:    first.GetArtifactId(),
		MimeType:      first.GetMimeType(),
		RouteDecision: job.GetRouteDecision(),
		ModelResolved: job.GetModelResolved(),
		TraceID:       traceID,
		Usage:         job.GetUsage(),
		Payload:       append([]byte(nil), first.GetBytes()...),
	}, nil
}

// ListModelsGRPC calls RuntimeModelService.ListModels over gRPC.
