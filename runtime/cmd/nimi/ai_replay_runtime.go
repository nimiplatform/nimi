package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func executeRuntimeReplay(grpcAddr string, timeout time.Duration, fixture *aiGoldFixture, callerMeta *entrypoint.ClientMetadata, subjectUserID string) (*aiReplayPayload, error) {
	basePayload := &aiReplayPayload{
		FixtureID:           fixture.FixtureID,
		Capability:          fixture.Capability,
		Layer:               "L1_RUNTIME_REPLAY",
		RequestDigest:       fixture.requestDigest(),
		ResolvedProvider:    strings.TrimSpace(fixture.Provider),
		ResolvedModel:       strings.TrimSpace(fixture.ModelID),
		ResolvedTargetModel: strings.TrimSpace(fixture.TargetModelID),
		RoutePolicy:         "token-api",
		FallbackPolicy:      "deny",
	}
	if fixture.routePolicy() == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME {
		basePayload.RoutePolicy = "local-runtime"
	}
	if strings.EqualFold(strings.TrimSpace(fixture.Capability), "text.generate") || strings.EqualFold(strings.TrimSpace(fixture.Capability), "text.embed") {
		req, err := fixture.buildExecuteScenarioRequest(aiReplayAppID, subjectUserID)
		if err != nil {
			return nil, err
		}
		resp, err := entrypoint.ExecuteScenarioGRPC(grpcAddr, timeout, req, callerMeta)
		if err != nil {
			return withReplayFailure(basePayload, err), nil
		}
		basePayload.Status = "passed"
		basePayload.TraceID = strings.TrimSpace(resp.GetTraceId())
		basePayload.ResolvedModel = firstNonEmptyString(strings.TrimSpace(resp.GetModelResolved()), basePayload.ResolvedModel)
		basePayload.ArtifactSummary = summarizeExecuteScenarioResponse(fixture, resp)
		return basePayload, nil
	}

	req, err := fixture.buildSubmitScenarioJobRequest(aiReplayAppID, subjectUserID)
	if err != nil {
		return nil, err
	}
	jobResp, err := submitAndCollectRuntimeReplay(grpcAddr, timeout, req, callerMeta)
	if err != nil {
		return withReplayFailure(basePayload, err), nil
	}
	basePayload.Status = "passed"
	basePayload.TraceID = strings.TrimSpace(jobResp.TraceID)
	basePayload.JobID = strings.TrimSpace(jobResp.JobID)
	basePayload.ResolvedModel = firstNonEmptyString(strings.TrimSpace(jobResp.ModelResolved), basePayload.ResolvedModel)
	basePayload.ArtifactSummary = jobResp.Summary
	if voiceAssetID := strings.TrimSpace(jobResp.VoiceAssetID); voiceAssetID != "" {
		basePayload.ArtifactSummary["voiceAssetId"] = voiceAssetID
	}
	return basePayload, nil
}

type runtimeReplayJobResult struct {
	JobID         string
	TraceID       string
	ModelResolved string
	VoiceAssetID  string
	Summary       map[string]any
}

func submitAndCollectRuntimeReplay(grpcAddr string, timeout time.Duration, req *runtimev1.SubmitScenarioJobRequest, callerMeta *entrypoint.ClientMetadata) (*runtimeReplayJobResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = entrypoint.WithNimiOutgoingMetadata(ctx, req.GetHead().GetAppId(), callerMeta)

	conn, err := grpc.NewClient(strings.TrimSpace(grpcAddr), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", grpcAddr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	resp, err := client.SubmitScenarioJob(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime ai submit scenario job: %w", err)
	}
	job := resp.GetJob()
	if job == nil || strings.TrimSpace(job.GetJobId()) == "" {
		return nil, fmt.Errorf("runtime ai submit scenario job returned empty job")
	}

	current := job
	jobID := strings.TrimSpace(job.GetJobId())
	traceID := strings.TrimSpace(job.GetTraceId())
	voiceAssetID := ""
	if resp.GetAsset() != nil {
		voiceAssetID = strings.TrimSpace(resp.GetAsset().GetVoiceAssetId())
	}
	deadline := time.Now().Add(timeout)
	for {
		statusValue := current.GetStatus()
		switch statusValue {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
			if traceID == "" {
				traceID = strings.TrimSpace(current.GetTraceId())
			}
			artifactsResp, artifactsErr := client.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
			if artifactsErr != nil {
				return nil, fmt.Errorf("runtime ai get scenario artifacts: %w", artifactsErr)
			}
			if traceID == "" {
				traceID = strings.TrimSpace(artifactsResp.GetTraceId())
			}
			return &runtimeReplayJobResult{
				JobID:         jobID,
				TraceID:       traceID,
				ModelResolved: strings.TrimSpace(current.GetModelResolved()),
				VoiceAssetID:  voiceAssetID,
				Summary:       summarizeScenarioArtifacts(artifactsResp.GetArtifacts()),
			}, nil
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED:
			reason := strings.TrimSpace(current.GetReasonDetail())
			if reason == "" {
				reason = strings.TrimSpace(current.GetReasonCode().String())
			}
			return nil, fmt.Errorf("%s", reason)
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("runtime ai scenario job timeout: %s", jobID)
		}
		time.Sleep(500 * time.Millisecond)
		pollResp, pollErr := client.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
		if pollErr != nil {
			return nil, fmt.Errorf("runtime ai get scenario job: %w", pollErr)
		}
		if pollResp.GetJob() == nil {
			return nil, fmt.Errorf("runtime ai get scenario job returned empty job")
		}
		current = pollResp.GetJob()
	}
}
