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

func ExecuteScenarioGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.ExecuteScenarioRequest, metadataOverride ...*ClientMetadata) (*runtimev1.ExecuteScenarioResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("execute scenario request is required")
	}
	if req.GetHead() == nil {
		return nil, errors.New("scenario request head is required")
	}
	if strings.TrimSpace(req.GetHead().GetAppId()) == "" {
		return nil, errors.New("app_id is required")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, req.GetHead().GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	resp, err := client.ExecuteScenario(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime ai execute scenario: %w", err)
	}
	return resp, nil
}

// SubmitScenarioJobAndCollectGRPC submits a scenario async job, polls until completion, and returns the first artifact payload.
func SubmitScenarioJobAndCollectGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.SubmitScenarioJobRequest, metadataOverride ...*ClientMetadata) (*ArtifactResult, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("submit scenario job request is required")
	}
	if req.GetHead() == nil {
		return nil, errors.New("head is required")
	}
	if strings.TrimSpace(req.GetHead().GetAppId()) == "" {
		return nil, errors.New("app_id is required")
	}
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, req.GetHead().GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	if req.GetExecutionMode() == runtimev1.ExecutionMode_EXECUTION_MODE_UNSPECIFIED {
		req.ExecutionMode = runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB
	}
	submitResp, err := client.SubmitScenarioJob(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime ai submit scenario job: %w", err)
	}
	job := submitResp.GetJob()
	if job == nil || strings.TrimSpace(job.GetJobId()) == "" {
		return nil, errors.New("runtime ai submit scenario job returned empty job")
	}

	jobID := strings.TrimSpace(job.GetJobId())
	for {
		switch job.GetStatus() {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
			return collectScenarioArtifactResult(ctx, client, job)
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING:
			time.Sleep(250 * time.Millisecond)
			pollResp, pollErr := client.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{
				JobId: jobID,
			})
			if pollErr != nil {
				return nil, fmt.Errorf("runtime ai get scenario job: %w", pollErr)
			}
			if pollResp.GetJob() == nil {
				return nil, errors.New("runtime ai get scenario job returned empty job")
			}
			job = pollResp.GetJob()
		default:
			reason := strings.TrimSpace(job.GetReasonDetail())
			if reason == "" {
				reason = strings.TrimSpace(job.GetReasonCode().String())
			}
			if reason == "" {
				reason = "unknown scenario job failure"
			}
			return nil, fmt.Errorf("runtime ai scenario job failed: %s", reason)
		}
	}
}

func collectScenarioArtifactResult(ctx context.Context, client runtimev1.RuntimeAiServiceClient, job *runtimev1.ScenarioJob) (*ArtifactResult, error) {
	if job == nil || strings.TrimSpace(job.GetJobId()) == "" {
		return nil, errors.New("scenario job is required")
	}
	jobID := strings.TrimSpace(job.GetJobId())
	artifacts := job.GetArtifacts()
	traceID := strings.TrimSpace(job.GetTraceId())
	if len(artifacts) == 0 {
		artifactsResp, artifactsErr := client.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{
			JobId: jobID,
		})
		if artifactsErr != nil {
			return nil, fmt.Errorf("runtime ai get scenario artifacts: %w", artifactsErr)
		}
		artifacts = artifactsResp.GetArtifacts()
		if traceID == "" {
			traceID = strings.TrimSpace(artifactsResp.GetTraceId())
		}
	}
	if len(artifacts) == 0 {
		return nil, errors.New("scenario job completed without artifacts")
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
