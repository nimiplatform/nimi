package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

type probeResult struct {
	JobID          string         `json:"jobId"`
	Status         string         `json:"status"`
	TraceID        string         `json:"traceId,omitempty"`
	ModelResolved  string         `json:"modelResolved,omitempty"`
	RouteDecision  string         `json:"routeDecision,omitempty"`
	ReasonCode     string         `json:"reasonCode,omitempty"`
	ReasonDetail   string         `json:"reasonDetail,omitempty"`
	ReasonMetadata map[string]any `json:"reasonMetadata,omitempty"`
	ArtifactPath   string         `json:"artifactPath,omitempty"`
	ArtifactMime   string         `json:"artifactMime,omitempty"`
	ArtifactBytes  int            `json:"artifactBytes,omitempty"`
}

func main() {
	grpcAddr := flag.String("grpc-addr", "127.0.0.1:46381", "runtime gRPC address")
	appID := flag.String("app-id", "nimi.desktop", "caller app id")
	subjectUserID := flag.String("subject-user-id", "local-user", "subject user id")
	modelID := flag.String("model-id", "", "runtime model id")
	prompt := flag.String("prompt", "", "image prompt")
	negativePrompt := flag.String("negative-prompt", "", "image negative prompt")
	size := flag.String("size", "1024x1024", "image size")
	timeout := flag.Duration("timeout", 10*time.Minute, "probe timeout")
	timeoutMS := flag.Int("timeout-ms", 600000, "request timeout in milliseconds")
	extensionJSONPath := flag.String("extension-json", "", "scenario extension json file")
	extensionNamespace := flag.String("extension-namespace", "nimi.scenario.image.request", "scenario extension namespace")
	outputPath := flag.String("output", "", "artifact output path")
	jsonOutput := flag.Bool("json", true, "print structured json output")
	progress := flag.Bool("progress", true, "print job progress to stderr")
	flag.Parse()

	if strings.TrimSpace(*modelID) == "" {
		exitf("model-id is required")
	}
	if strings.TrimSpace(*prompt) == "" {
		exitf("prompt is required")
	}
	if *timeoutMS <= 0 {
		exitf("timeout-ms must be > 0")
	}

	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         strings.TrimSpace(*appID),
			SubjectUserId: strings.TrimSpace(*subjectUserID),
			ModelId:       strings.TrimSpace(*modelID),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     int32(*timeoutMS),
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt:         strings.TrimSpace(*prompt),
					NegativePrompt: strings.TrimSpace(*negativePrompt),
					N:              1,
					Size:           strings.TrimSpace(*size),
				},
			},
		},
	}

	if strings.TrimSpace(*extensionJSONPath) != "" {
		extensionPayload, err := loadExtensionPayload(*extensionJSONPath)
		if err != nil {
			exitf("load extension payload: %v", err)
		}
		req.Extensions = []*runtimev1.ScenarioExtension{{
			Namespace: strings.TrimSpace(*extensionNamespace),
			Payload:   extensionPayload,
		}}
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	ctx = entrypoint.WithNimiOutgoingMetadata(ctx, req.GetHead().GetAppId(), &entrypoint.ClientMetadata{
		CallerKind: "third-party-service",
		CallerID:   "nimi-cli",
		SurfaceID:  "runtime-cli",
	})

	conn, err := grpc.NewClient(strings.TrimSpace(*grpcAddr), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		exitf("dial grpc: %v", err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	submitResp, err := client.SubmitScenarioJob(ctx, req)
	if err != nil {
		exitf("submit scenario job: %v", err)
	}
	job := submitResp.GetJob()
	if job == nil || strings.TrimSpace(job.GetJobId()) == "" {
		exitf("submit scenario job returned empty job")
	}

	jobID := strings.TrimSpace(job.GetJobId())
	lastStatus := job.GetStatus()
	if *progress {
		fmt.Fprintf(os.Stderr, "submitted job_id=%s status=%s trace=%s\n", jobID, lastStatus.String(), strings.TrimSpace(job.GetTraceId()))
	}
	for {
		switch job.GetStatus() {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
			artifactsResp, err := client.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
			if err != nil {
				exitf("get scenario artifacts: %v", err)
			}
			artifacts := artifactsResp.GetArtifacts()
			result := buildResult(job, "")
			if len(artifacts) > 0 {
				first := artifacts[0]
				result.ArtifactMime = strings.TrimSpace(first.GetMimeType())
				result.ArtifactBytes = len(first.GetBytes())
				path, err := writeArtifact(strings.TrimSpace(*outputPath), first.GetMimeType(), first.GetBytes())
				if err != nil {
					exitf("write artifact: %v", err)
				}
				result.ArtifactPath = path
			}
			printResult(*jsonOutput, result, job)
			return
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED:
			printResult(*jsonOutput, buildResult(job, ""), job)
			os.Exit(1)
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING:
			time.Sleep(500 * time.Millisecond)
			pollResp, err := client.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
			if err != nil {
				exitf("get scenario job: %v", err)
			}
			if pollResp.GetJob() == nil {
				exitf("get scenario job returned empty job")
			}
			job = pollResp.GetJob()
			if *progress && job.GetStatus() != lastStatus {
				lastStatus = job.GetStatus()
				fmt.Fprintf(os.Stderr, "job_id=%s status=%s trace=%s reason=%s\n", jobID, lastStatus.String(), strings.TrimSpace(job.GetTraceId()), strings.TrimSpace(job.GetReasonDetail()))
			}
		default:
			printResult(*jsonOutput, buildResult(job, ""), job)
			os.Exit(1)
		}
	}
}

func loadExtensionPayload(path string) (*structpb.Struct, error) {
	raw, err := os.ReadFile(strings.TrimSpace(path))
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	return structpb.NewStruct(payload)
}

func buildResult(job *runtimev1.ScenarioJob, artifactPath string) probeResult {
	result := probeResult{
		ArtifactPath:  strings.TrimSpace(artifactPath),
		JobID:         strings.TrimSpace(job.GetJobId()),
		Status:        job.GetStatus().String(),
		TraceID:       strings.TrimSpace(job.GetTraceId()),
		ModelResolved: strings.TrimSpace(job.GetModelResolved()),
		RouteDecision: job.GetRouteDecision().String(),
		ReasonCode:    job.GetReasonCode().String(),
		ReasonDetail:  strings.TrimSpace(job.GetReasonDetail()),
	}
	if metadata := job.GetReasonMetadata(); metadata != nil {
		result.ReasonMetadata = metadata.AsMap()
	}
	return result
}

func writeArtifact(outputPath string, mimeType string, payload []byte) (string, error) {
	if len(payload) == 0 {
		return "", nil
	}
	path := strings.TrimSpace(outputPath)
	if path == "" {
		file, err := os.CreateTemp("", "scenariojobprobe-*"+artifactExtension(mimeType))
		if err != nil {
			return "", err
		}
		path = file.Name()
		if _, err := file.Write(payload); err != nil {
			file.Close()
			return "", err
		}
		if err := file.Close(); err != nil {
			return "", err
		}
		return path, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func artifactExtension(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ".bin"
	}
}

func printResult(jsonOutput bool, result probeResult, job *runtimev1.ScenarioJob) {
	if jsonOutput {
		out, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			exitf("marshal result: %v", err)
		}
		fmt.Println(string(out))
		return
	}
	fmt.Printf("job=%s status=%s trace=%s model=%s route=%s\n", result.JobID, result.Status, result.TraceID, result.ModelResolved, result.RouteDecision)
	if result.ReasonDetail != "" {
		fmt.Printf("reason=%s\n", result.ReasonDetail)
	}
	if result.ArtifactPath != "" {
		fmt.Printf("artifact=%s mime=%s bytes=%d\n", result.ArtifactPath, result.ArtifactMime, result.ArtifactBytes)
	}
	if job != nil {
		marshal := protojson.MarshalOptions{Multiline: true, Indent: "  "}
		if encoded, err := marshal.Marshal(job); err == nil {
			fmt.Println(string(encoded))
		}
	}
}

func exitf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
