package ai

import (
	"context"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

const (
	maxLocalAppScenarioEmbedInputs     = 16
	maxLocalAppScenarioEmbedInputBytes = 32 * 1024
	maxLocalAppScenarioEmbedTotalBytes = 64 * 1024
	maxLocalAppScenarioPromptBytes     = 32 * 1024
	maxLocalAppScenarioOptionTextBytes = 128
	maxLocalAppScenarioJobArtifacts    = 16
	maxLocalAppScenarioJobIDBytes      = 128
	maxLocalAppInlineArtifactBytes     = 32 * 1024 * 1024
	maxLocalAppEmbeddingVectors        = 16
	maxLocalAppEmbeddingDimensions     = 8192
	maxLocalAppTraceIDBytes            = 512
	maxLocalAppTranscriptionTextBytes  = 1 << 20
	maxLocalAppSafeInteger             = int64(1<<53 - 1)
)

// localAppScenarioDecision mirrors the GenerateLocalAppTextCandidate admission
// gate: the exact operation, AppAccess authority class, and contract-owned
// capability identity must match the admission decision carried by the
// protected transport, otherwise the call fails closed.
func localAppScenarioDecision(ctx context.Context, operation accountservice.LocalAppOperation, capability string) (accountservice.LocalAppCallerDecision, error) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.Operation != operation ||
		decision.AuthorityClass != localappop.AuthorityClassAppAccess ||
		decision.OperationCapability != capability {
		return accountservice.LocalAppCallerDecision{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	return decision, nil
}

func localAppScenarioHead(decision accountservice.LocalAppCallerDecision) *runtimev1.ScenarioRequestHead {
	return &runtimev1.ScenarioRequestHead{
		AppId:         decision.AppID,
		SubjectUserId: decision.AccountID,
	}
}

// localAppOwnerCallContext projects the admitted session-derived owner into
// the identity carriers the in-process Scenario owner surfaces authorize
// against (authn identity + x-nimi-app-id metadata). Every value comes from
// the admission decision; caller-supplied identity never enters this context.
func localAppOwnerCallContext(ctx context.Context, decision accountservice.LocalAppCallerDecision) context.Context {
	ownerCtx := authn.WithIdentity(ctx, &authn.Identity{SubjectUserID: decision.AccountID})
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		md = metadata.MD{}
	}
	md = md.Copy()
	md.Set(metadataAppIDKey, decision.AppID)
	return metadata.NewIncomingContext(ownerCtx, md)
}

func localAppExactText(value string, maxBytes int) bool {
	return value != "" && strings.TrimSpace(value) == value && len([]byte(value)) <= maxBytes
}

func localAppOptionalExactText(value string, maxBytes int) bool {
	return value == "" || localAppExactText(value, maxBytes)
}

func localAppHTTPSURL(value string, maxBytes int) bool {
	return localAppExactText(value, maxBytes) && strings.HasPrefix(value, "https://")
}

func localAppBoundedIdentifier(value string) bool {
	if !localAppExactText(value, maxLocalAppScenarioJobIDBytes) {
		return false
	}
	return strings.IndexFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f }) < 0
}

// projectLocalAppScenarioArtifact trims one owner ScenarioArtifact to the
// Local App projection. Runtime-private uri, producer, owner, speech
// alignment, and free-form metadata fields never cross this boundary; an
// artifact outside the typed shape fails closed.
func projectLocalAppScenarioArtifact(artifact *runtimev1.ScenarioArtifact) (*runtimev1.LocalAppScenarioArtifact, error) {
	invalid := func() (*runtimev1.LocalAppScenarioArtifact, error) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if artifact == nil {
		return invalid()
	}
	artifactID := artifact.GetArtifactId()
	if !localAppBoundedIdentifier(artifactID) {
		return invalid()
	}
	mimeType := artifact.GetMimeType()
	if !localAppExactText(mimeType, maxLocalAppScenarioOptionTextBytes) {
		return invalid()
	}
	sha256 := artifact.GetSha256()
	if !localAppOptionalExactText(sha256, maxLocalAppScenarioOptionTextBytes) {
		return invalid()
	}
	sizeBytes := artifact.GetSizeBytes()
	if sizeBytes < 0 || sizeBytes > maxLocalAppSafeInteger {
		return invalid()
	}
	if sizeBytes == 0 && len(artifact.GetBytes()) > 0 {
		sizeBytes = int64(len(artifact.GetBytes()))
	}
	if artifact.GetDurationMs() < 0 || artifact.GetWidth() < 0 || artifact.GetHeight() < 0 ||
		artifact.GetSampleRateHz() < 0 || artifact.GetChannels() < 0 || artifact.GetFps() < 0 {
		return invalid()
	}
	return &runtimev1.LocalAppScenarioArtifact{
		ArtifactId:   artifactID,
		MimeType:     mimeType,
		SizeBytes:    sizeBytes,
		Sha256:       sha256,
		DurationMs:   artifact.GetDurationMs(),
		Width:        artifact.GetWidth(),
		Height:       artifact.GetHeight(),
		SampleRateHz: artifact.GetSampleRateHz(),
		Channels:     artifact.GetChannels(),
	}, nil
}

func projectLocalAppScenarioArtifacts(artifacts []*runtimev1.ScenarioArtifact) ([]*runtimev1.LocalAppScenarioArtifact, error) {
	if len(artifacts) == 0 || len(artifacts) > maxLocalAppScenarioJobArtifacts {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	projected := make([]*runtimev1.LocalAppScenarioArtifact, 0, len(artifacts))
	for _, artifact := range artifacts {
		item, err := projectLocalAppScenarioArtifact(artifact)
		if err != nil {
			return nil, err
		}
		projected = append(projected, item)
	}
	return projected, nil
}

func localAppValidTraceID(traceID string) bool {
	return localAppExactText(traceID, maxLocalAppTraceIDBytes)
}

// ExecuteLocalAppScenario preserves the third-party Local App synchronous
// scenario contract while delegating route composition, scheduling, Driver
// mapping, metering, and execution to the Scenario owner. The App supplies a
// closed-set SYNC spec only: no route, implementation, target, grant, model,
// tool, stream, or job field.
func (s *Service) ExecuteLocalAppScenario(ctx context.Context, req *runtimev1.ExecuteLocalAppScenarioRequest) (*runtimev1.ExecuteLocalAppScenarioResponse, error) {
	decision, err := localAppScenarioDecision(ctx, accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute)
	if err != nil {
		return nil, err
	}
	ownerSpec, scenarioType, err := validateLocalAppScenarioExecuteRequest(req)
	if err != nil {
		return nil, err
	}
	result, err := s.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head:          localAppScenarioHead(decision),
		ScenarioType:  scenarioType,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec:          ownerSpec,
	})
	if err != nil {
		return nil, err
	}
	if result == nil || !localAppTextCandidateFinishReason(result.GetFinishReason()) || !localAppValidTraceID(result.GetTraceId()) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED:
		embed := result.GetOutput().GetTextEmbed()
		if embed == nil || result.GetOutput().GetImageGenerate() != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		vectors := embed.GetVectors()
		if len(vectors) == 0 || len(vectors) > maxLocalAppEmbeddingVectors {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		for _, vector := range vectors {
			if vector == nil || len(vector.GetValues()) == 0 || len(vector.GetValues()) > maxLocalAppEmbeddingDimensions {
				return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			}
			for _, value := range vector.GetValues() {
				if math.IsNaN(value) || math.IsInf(value, 0) {
					return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
				}
			}
		}
		return &runtimev1.ExecuteLocalAppScenarioResponse{
			Output:  &runtimev1.ExecuteLocalAppScenarioResponse_TextEmbed{TextEmbed: &runtimev1.LocalAppTextEmbedOutput{Vectors: vectors}},
			TraceId: result.GetTraceId(),
		}, nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		image := result.GetOutput().GetImageGenerate()
		if image == nil || result.GetOutput().GetTextEmbed() != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		artifacts, err := projectLocalAppScenarioArtifacts(image.GetArtifacts())
		if err != nil {
			return nil, err
		}
		return &runtimev1.ExecuteLocalAppScenarioResponse{
			Output:  &runtimev1.ExecuteLocalAppScenarioResponse_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateOutput{Artifacts: artifacts}},
			TraceId: result.GetTraceId(),
		}, nil
	default:
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
}

func validateLocalAppScenarioExecuteRequest(req *runtimev1.ExecuteLocalAppScenarioRequest) (*runtimev1.ScenarioSpec, runtimev1.ScenarioType, error) {
	if req == nil || req.GetSpec() == nil {
		return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch spec := req.GetSpec().(type) {
	case *runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed:
		inputs, err := validateLocalAppEmbedInputs(spec.TextEmbed.GetInputs())
		if err != nil {
			return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, err
		}
		return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{
			TextEmbed: &runtimev1.TextEmbedScenarioSpec{Inputs: inputs},
		}}, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, nil
	case *runtimev1.ExecuteLocalAppScenarioRequest_ImageGenerate:
		image, err := validateLocalAppImageGenerateSpec(spec.ImageGenerate)
		if err != nil {
			return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, err
		}
		return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{
			ImageGenerate: image,
		}}, runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, nil
	default:
		return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
}

func validateLocalAppEmbedInputs(inputs []string) ([]string, error) {
	if len(inputs) == 0 || len(inputs) > maxLocalAppScenarioEmbedInputs {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	totalBytes := 0
	out := make([]string, 0, len(inputs))
	for _, input := range inputs {
		if !localAppExactText(input, maxLocalAppScenarioEmbedInputBytes) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		totalBytes += len([]byte(input))
		if totalBytes > maxLocalAppScenarioEmbedTotalBytes {
			return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		out = append(out, input)
	}
	return out, nil
}

func validateLocalAppImageGenerateSpec(spec *runtimev1.LocalAppImageGenerateScenarioSpec) (*runtimev1.ImageGenerateScenarioSpec, error) {
	if spec == nil || !localAppExactText(spec.GetPrompt(), maxLocalAppScenarioPromptBytes) ||
		!localAppOptionalExactText(spec.GetNegativePrompt(), maxLocalAppScenarioPromptBytes) ||
		!localAppOptionalExactText(spec.GetSize(), maxLocalAppScenarioOptionTextBytes) ||
		!localAppOptionalExactText(spec.GetAspectRatio(), maxLocalAppScenarioOptionTextBytes) ||
		!localAppOptionalExactText(spec.GetQuality(), maxLocalAppScenarioOptionTextBytes) ||
		!localAppOptionalExactText(spec.GetStyle(), maxLocalAppScenarioOptionTextBytes) ||
		len(spec.GetReferenceImages()) > 1 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if spec.N != nil && (spec.GetN() < 0 || spec.GetN() > 16) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	for _, reference := range spec.GetReferenceImages() {
		if !localAppHTTPSURL(reference, maxLocalAppScenarioReferenceURIBytes) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
	if mask := spec.GetMask(); mask != "" && !localAppHTTPSURL(mask, maxLocalAppScenarioReferenceURIBytes) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	format := spec.GetResponseFormat()
	if format != "" && format != "b64_json" && format != "url" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return &runtimev1.ImageGenerateScenarioSpec{
		Prompt:          spec.GetPrompt(),
		NegativePrompt:  spec.GetNegativePrompt(),
		N:               localAppOptionalInt32(spec.N),
		Size:            spec.GetSize(),
		AspectRatio:     spec.GetAspectRatio(),
		Quality:         spec.GetQuality(),
		Style:           spec.GetStyle(),
		Seed:            localAppOptionalInt64(spec.Seed),
		ReferenceImages: append([]string(nil), spec.GetReferenceImages()...),
		Mask:            spec.GetMask(),
		ResponseFormat:  format,
	}, nil
}
