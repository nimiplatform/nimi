package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	aiReplayAppID = "nimi.gold-path"
)

type noopGoldJobUpdater struct{}

func (noopGoldJobUpdater) UpdatePollState(string, string, int32, *timestamppb.Timestamp, string) {}

type aiReplayPayload struct {
	FixtureID            string         `json:"fixtureId"`
	Capability           string         `json:"capability"`
	Layer                string         `json:"layer"`
	Status               string         `json:"status"`
	TraceID              string         `json:"traceId"`
	RequestDigest        string         `json:"requestDigest"`
	ResolvedProvider     string         `json:"resolvedProvider"`
	ResolvedModel        string         `json:"resolvedModel"`
	ResolvedTargetModel  string         `json:"resolvedTargetModel,omitempty"`
	RoutePolicy          string         `json:"routePolicy"`
	FallbackPolicy       string         `json:"fallbackPolicy"`
	JobID                string         `json:"jobId,omitempty"`
	ArtifactSummary      map[string]any `json:"artifactSummary,omitempty"`
	ReasonCode           string         `json:"reasonCode,omitempty"`
	ActionHint           string         `json:"actionHint,omitempty"`
	Error                string         `json:"error,omitempty"`
	ProviderResponseMeta map[string]any `json:"providerResponseMeta,omitempty"`
}

type aiReplayErrorDetails struct {
	ReasonCode string
	ActionHint string
	Message    string
}

func runRuntimeAIReplay(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi ai replay", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "3m", "grpc request timeout")
	fixturePath := fs.String("fixture", "", "gold fixture path")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	subjectUserID := fs.String("subject-user-id", strings.TrimSpace(os.Getenv("NIMI_LIVE_GOLD_SUBJECT_USER_ID")), "subject user id for gold replay auth context")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*subjectUserID) == "" {
		return fmt.Errorf("subject-user-id is required for gold replay auth context (or set NIMI_LIVE_GOLD_SUBJECT_USER_ID)")
	}

	fixture, err := loadAIGoldFixture(*fixturePath)
	if err != nil {
		return err
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	payload, err := executeRuntimeReplay(*grpcAddr, timeout, fixture, callerMeta, *subjectUserID)
	if err != nil {
		return err
	}
	return printJSON(payload)
}

func runRuntimeAIProviderRaw(args []string) error {
	fs := flag.NewFlagSet("nimi ai provider-raw", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	fixturePath := fs.String("fixture", "", "gold fixture path")
	timeoutRaw := fs.String("timeout", "3m", "provider request timeout")
	if err := fs.Parse(args); err != nil {
		return err
	}

	fixture, err := loadAIGoldFixture(*fixturePath)
	if err != nil {
		return err
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	payload, err := executeProviderRawReplay(timeout, fixture)
	if err != nil {
		return err
	}
	return printJSON(payload)
}

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

func executeProviderRawReplay(timeout time.Duration, fixture *aiGoldFixture) (*aiReplayPayload, error) {
	payload := &aiReplayPayload{
		FixtureID:           fixture.FixtureID,
		Capability:          fixture.Capability,
		Layer:               "L0_PROVIDER_RAW",
		RequestDigest:       fixture.requestDigest(),
		ResolvedProvider:    strings.TrimSpace(fixture.Provider),
		ResolvedModel:       strings.TrimSpace(fixture.ModelID),
		ResolvedTargetModel: strings.TrimSpace(fixture.TargetModelID),
		RoutePolicy:         "token-api",
		FallbackPolicy:      "deny",
		TraceID:             "provider-raw-" + fixture.requestDigest()[:12],
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	record, ok := providerregistry.Lookup(strings.TrimSpace(fixture.Provider))
	if !ok {
		return nil, fmt.Errorf("unknown provider %q", fixture.Provider)
	}
	baseURL := strings.TrimSpace(os.Getenv("NIMI_LIVE_" + providerEnvToken(record.ID) + "_BASE_URL"))
	if baseURL == "" {
		baseURL = strings.TrimSpace(record.DefaultEndpoint)
	}
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_" + providerEnvToken(record.ID) + "_API_KEY"))
	if apiKey == "" {
		return nil, fmt.Errorf("missing NIMI_LIVE_%s_API_KEY", providerEnvToken(record.ID))
	}
	backend := nimillm.NewBackend("gold-"+record.ID, baseURL, apiKey, timeout)
	if backend == nil {
		return nil, fmt.Errorf("provider backend unavailable for %s", record.ID)
	}
	configValue := nimillm.MediaAdapterConfig{BaseURL: baseURL, APIKey: apiKey}
	switch strings.TrimSpace(strings.ToLower(fixture.Capability)) {
	case "text.generate":
		text, usage, finishReason, err := backend.GenerateText(ctx, strings.TrimSpace(fixture.ModelID), []*runtimev1.ChatMessage{{
			Role:    "user",
			Content: strings.TrimSpace(fixture.Request.Prompt),
		}}, strings.TrimSpace(fixture.Request.SystemPrompt), 0, 0, 0)
		if err != nil {
			return withReplayFailure(payload, err), nil
		}
		payload.Status = "passed"
		payload.ArtifactSummary = map[string]any{
			"textLength":    len(strings.TrimSpace(text)),
			"finishReason":  finishReason.String(),
			"inputTokens":   safeUsageInputTokens(usage),
			"outputTokens":  safeUsageOutputTokens(usage),
			"computeMs":     safeUsageComputeMs(usage),
			"textPreview":   trimPreview(text),
			"artifactCount": 0,
		}
	case "text.embed":
		vectors, usage, err := backend.Embed(ctx, strings.TrimSpace(fixture.ModelID), fixture.Request.Inputs)
		if err != nil {
			return withReplayFailure(payload, err), nil
		}
		payload.Status = "passed"
		payload.ArtifactSummary = map[string]any{
			"vectorCount":  len(vectors),
			"inputTokens":  safeUsageInputTokens(usage),
			"outputTokens": safeUsageOutputTokens(usage),
			"computeMs":    safeUsageComputeMs(usage),
		}
	case "image.generate", "audio.synthesize":
		req, err := fixture.buildSubmitScenarioJobRequest(aiReplayAppID, "")
		if err != nil {
			return nil, err
		}
		artifacts, usage, providerJobID, err := nimillm.ExecuteAlibabaNative(ctx, configValue, noopGoldJobUpdater{}, "gold-provider-raw", req, strings.TrimSpace(fixture.ModelID))
		if err != nil {
			return withReplayFailure(payload, err), nil
		}
		payload.Status = "passed"
		payload.JobID = strings.TrimSpace(providerJobID)
		payload.ArtifactSummary = summarizeScenarioArtifacts(artifacts)
		payload.ArtifactSummary["inputTokens"] = safeUsageInputTokens(usage)
		payload.ArtifactSummary["outputTokens"] = safeUsageOutputTokens(usage)
		payload.ArtifactSummary["computeMs"] = safeUsageComputeMs(usage)
	case "audio.transcribe":
		req, err := fixture.buildSubmitScenarioJobRequest(aiReplayAppID, "")
		if err != nil {
			return nil, err
		}
		artifacts, usage, providerJobID, err := nimillm.ExecuteDashScopeTranscribe(ctx, configValue, req, strings.TrimSpace(fixture.ModelID))
		if err != nil {
			return withReplayFailure(payload, err), nil
		}
		payload.Status = "passed"
		payload.JobID = strings.TrimSpace(providerJobID)
		payload.ArtifactSummary = summarizeScenarioArtifacts(artifacts)
		payload.ArtifactSummary["inputTokens"] = safeUsageInputTokens(usage)
		payload.ArtifactSummary["outputTokens"] = safeUsageOutputTokens(usage)
		payload.ArtifactSummary["computeMs"] = safeUsageComputeMs(usage)
	case "voice.clone", "voice.design":
		workflowType := "tts_v2v"
		providerPayload := map[string]any{}
		if strings.EqualFold(strings.TrimSpace(fixture.Capability), "voice.design") {
			workflowType = "tts_t2v"
			providerPayload["text"] = strings.TrimSpace(fixture.Request.InstructionText)
			providerPayload["instruction_text"] = strings.TrimSpace(fixture.Request.InstructionText)
		} else {
			audioURI, audioBytes, audioMime, audioErr := fixture.resolveAudioInput()
			if audioErr != nil {
				return withReplayFailure(payload, audioErr), nil
			}
			if strings.TrimSpace(audioURI) != "" {
				providerPayload["reference_audio_uri"] = strings.TrimSpace(audioURI)
			}
			if len(audioBytes) > 0 {
				providerPayload["reference_audio_base64"] = base64.StdEncoding.EncodeToString(audioBytes)
				providerPayload["reference_audio_mime"] = strings.TrimSpace(audioMime)
			}
		}
		workflowModelID, targetModelID, resolveErr := resolveProviderRawVoiceWorkflow(fixture, workflowType)
		if resolveErr != nil {
			return withReplayFailure(payload, resolveErr), nil
		}
		result, err := nimillm.ExecuteVoiceWorkflow(ctx, nimillm.VoiceWorkflowRequest{
			Provider:        strings.TrimSpace(fixture.Provider),
			WorkflowType:    workflowType,
			WorkflowModelID: workflowModelID,
			ModelID:         targetModelID,
			Payload:         providerPayload,
			ExtPayload:      map[string]any{},
		}, configValue)
		if err != nil {
			return withReplayFailure(payload, err), nil
		}
		payload.Status = "passed"
		payload.JobID = strings.TrimSpace(result.ProviderJobID)
		payload.ArtifactSummary = map[string]any{
			"voiceAssetId":     strings.TrimSpace(result.ProviderVoiceRef),
			"providerMetadata": result.Metadata,
			"artifactCount":    0,
			"providerJobID":    strings.TrimSpace(result.ProviderJobID),
			"providerVoiceRef": strings.TrimSpace(result.ProviderVoiceRef),
		}
	case "video.generate":
		payload.Status = "skipped"
		payload.ReasonCode = "L0_MODALITY_NOT_SUPPORTED"
		payload.ActionHint = "video_generate_not_supported_in_gold_path_l0"
		return payload, nil
	default:
		return nil, fmt.Errorf("unsupported capability %q", fixture.Capability)
	}
	return payload, nil
}

func summarizeExecuteScenarioResponse(fixture *aiGoldFixture, resp *runtimev1.ExecuteScenarioResponse) map[string]any {
	out := map[string]any{
		"finishReason": resp.GetFinishReason().String(),
		"inputTokens":  safeUsageInputTokens(resp.GetUsage()),
		"outputTokens": safeUsageOutputTokens(resp.GetUsage()),
		"computeMs":    safeUsageComputeMs(resp.GetUsage()),
	}
	switch strings.TrimSpace(strings.ToLower(fixture.Capability)) {
	case "text.generate":
		text := extractStructStringField(resp.GetOutput(), "text")
		out["textLength"] = len(strings.TrimSpace(text))
		out["textPreview"] = trimPreview(text)
	case "text.embed":
		out["vectorCount"] = extractStructListCount(resp.GetOutput(), "vectors")
	}
	return out
}

func summarizeScenarioArtifacts(artifacts []*runtimev1.ScenarioArtifact) map[string]any {
	mimeTypes := make([]string, 0, len(artifacts))
	totalBytes := 0
	artifactIDs := make([]string, 0, len(artifacts))
	textPreview := ""
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		if trimmed := strings.TrimSpace(artifact.GetMimeType()); trimmed != "" {
			mimeTypes = append(mimeTypes, trimmed)
		}
		artifactIDs = append(artifactIDs, strings.TrimSpace(artifact.GetArtifactId()))
		totalBytes += len(artifact.GetBytes())
		if textPreview == "" && strings.HasPrefix(strings.ToLower(strings.TrimSpace(artifact.GetMimeType())), "text/") {
			textPreview = trimPreview(string(artifact.GetBytes()))
		}
	}
	return map[string]any{
		"artifactCount": len(artifacts),
		"artifactIds":   artifactIDs,
		"mimeTypes":     mimeTypes,
		"totalBytes":    totalBytes,
		"textPreview":   textPreview,
		"base64Preview": firstArtifactBase64(artifacts),
	}
}

func extractStructStringField(output *structpb.Struct, key string) string {
	if output == nil {
		return ""
	}
	field, ok := output.GetFields()[key]
	if !ok || field == nil {
		return ""
	}
	return strings.TrimSpace(field.GetStringValue())
}

func extractStructListCount(output *structpb.Struct, key string) int {
	if output == nil {
		return 0
	}
	field, ok := output.GetFields()[key]
	if !ok || field == nil || field.GetListValue() == nil {
		return 0
	}
	return len(field.GetListValue().GetValues())
}

func firstArtifactBase64(artifacts []*runtimev1.ScenarioArtifact) string {
	for _, artifact := range artifacts {
		if artifact == nil || len(artifact.GetBytes()) == 0 {
			continue
		}
		encoded := base64.StdEncoding.EncodeToString(artifact.GetBytes())
		if len(encoded) > 64 {
			return encoded[:64]
		}
		return encoded
	}
	return ""
}

func safeUsageInputTokens(usage *runtimev1.UsageStats) int64 {
	if usage == nil {
		return 0
	}
	return usage.GetInputTokens()
}

func safeUsageOutputTokens(usage *runtimev1.UsageStats) int64 {
	if usage == nil {
		return 0
	}
	return usage.GetOutputTokens()
}

func safeUsageComputeMs(usage *runtimev1.UsageStats) int64 {
	if usage == nil {
		return 0
	}
	return usage.GetComputeMs()
}

func trimPreview(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) > 120 {
		return trimmed[:120]
	}
	return trimmed
}

func withReplayFailure(payload *aiReplayPayload, err error) *aiReplayPayload {
	out := *payload
	details := extractReplayErrorDetails(err)
	out.Status = "failed"
	out.ReasonCode = details.ReasonCode
	out.ActionHint = details.ActionHint
	out.Error = details.Message
	return &out
}

func extractReplayErrorDetails(err error) aiReplayErrorDetails {
	if err == nil {
		return aiReplayErrorDetails{}
	}
	message := strings.TrimSpace(err.Error())
	if grpcStatus, ok := status.FromError(err); ok {
		message = strings.TrimSpace(grpcStatus.Message())
	}
	payload := map[string]any{}
	if json.Unmarshal([]byte(message), &payload) == nil {
		reasonCode := strings.TrimSpace(replayAsString(payload["reasonCode"]))
		actionHint := strings.TrimSpace(replayAsString(payload["actionHint"]))
		if detail := strings.TrimSpace(replayAsString(payload["message"])); detail != "" {
			message = detail
		}
		if reasonCode != "" || actionHint != "" {
			return aiReplayErrorDetails{
				ReasonCode: reasonCode,
				ActionHint: actionHint,
				Message:    firstNonEmptyString(message, strings.TrimSpace(err.Error())),
			}
		}
	}
	reasonCode := extractReasonCodeFromText(message)
	actionHint := extractActionHintFromText(message)
	return aiReplayErrorDetails{
		ReasonCode: reasonCode,
		ActionHint: actionHint,
		Message:    firstNonEmptyString(message, strings.TrimSpace(err.Error())),
	}
}

func extractReasonCodeFromText(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}
	parts := strings.FieldsFunc(text, func(r rune) bool {
		return !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && r != '_'
	})
	for _, part := range parts {
		if strings.HasPrefix(part, "AI_") || strings.HasPrefix(part, "RUNTIME_") || strings.HasPrefix(part, "VIDEOPLAY_") {
			return part
		}
	}
	return ""
}

func extractActionHintFromText(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}
	if marker := "actionHint="; strings.Contains(text, marker) {
		segment := strings.SplitN(text, marker, 2)[1]
		return strings.Fields(segment)[0]
	}
	return ""
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func replayAsString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(value)
	}
}

func providerEnvToken(providerID string) string {
	token := strings.TrimSpace(strings.ToUpper(providerID))
	token = strings.ReplaceAll(token, "-", "_")
	token = strings.ReplaceAll(token, ".", "_")
	token = strings.ReplaceAll(token, " ", "_")
	for strings.Contains(token, "__") {
		token = strings.ReplaceAll(token, "__", "_")
	}
	return strings.Trim(token, "_")
}

func resolveProviderRawVoiceWorkflow(fixture *aiGoldFixture, workflowType string) (string, string, error) {
	if fixture == nil {
		return "", "", fmt.Errorf("fixture is required")
	}
	targetModelID := strings.TrimSpace(fixture.TargetModelID)
	if targetModelID == "" {
		targetModelID = strings.TrimSpace(fixture.ModelID)
	}
	resolver, err := catalog.NewResolver(catalog.ResolverConfig{})
	if err != nil {
		return "", "", fmt.Errorf("load voice workflow catalog: %w", err)
	}
	resolution, err := resolver.ResolveVoiceWorkflow(strings.TrimSpace(fixture.Provider), strings.TrimSpace(fixture.ModelID), workflowType)
	if err != nil {
		if err == catalog.ErrModelNotFound {
			return "", "", fmt.Errorf("%s", runtimev1.ReasonCode_AI_MODEL_NOT_FOUND.String())
		}
		if err == catalog.ErrVoiceWorkflowUnsupported {
			return "", "", fmt.Errorf("%s", runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED.String())
		}
		return "", "", fmt.Errorf("resolve voice workflow: %w", err)
	}
	return strings.TrimSpace(resolution.WorkflowModelID), targetModelID, nil
}

func printJSON(value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(raw))
	return nil
}
