package nimillm

import (
	"context"
	"encoding/base64"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

// MiniMax image_generation is a finite response containing the whole image
// set. Its top-level id is a trace, never a task query selector.
// https://platform.minimax.io/docs/api-reference/image-generation-t2i
func executeMiniMaxImage(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string, extensions func(*runtimev1.SubmitScenarioJobRequest) *structpb.Struct) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	unsupported := func() error {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	invalid := func() error { return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID) }
	spec := scenarioImageSpec(req)
	if spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" || strings.TrimSpace(model) == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if utf8.RuneCountInString(spec.GetPrompt()) > 1500 {
		return nil, nil, "", unsupported()
	}
	if spec.GetNegativePrompt() != "" || spec.GetQuality() != "" || spec.GetStyle() != "" || spec.GetMask() != "" || spec.GetMaskArtifactId() != "" || spec.GetReferenceImageArtifactId() != "" || spec.Strength != nil {
		return nil, nil, "", unsupported()
	}
	if extensions != nil && len(StructToMap(extensions(req))) > 0 {
		return nil, nil, "", unsupported()
	}
	n := spec.GetN()
	if n == 0 {
		n = 1
	}
	if n < 1 || n > 9 {
		return nil, nil, "", unsupported()
	}
	format := strings.TrimSpace(spec.GetResponseFormat())
	if format == "" {
		format = "url"
	}
	if format != "url" && format != "base64" {
		return nil, nil, "", unsupported()
	}
	payload := map[string]any{"model": model, "prompt": strings.TrimSpace(spec.GetPrompt()), "n": n, "response_format": format}
	if spec.Seed != nil {
		payload["seed"] = spec.GetSeed()
	}
	if size := spec.GetSize(); size != "" {
		parts := strings.Split(size, "x")
		if len(parts) != 2 {
			return nil, nil, "", unsupported()
		}
		width, e1 := strconv.Atoi(parts[0])
		height, e2 := strconv.Atoi(parts[1])
		if e1 != nil || e2 != nil || width < 512 || width > 2048 || height < 512 || height > 2048 || width%8 != 0 || height%8 != 0 {
			return nil, nil, "", unsupported()
		}
		payload["width"], payload["height"] = width, height
	}
	if ratio := spec.GetAspectRatio(); ratio != "" {
		switch ratio {
		case "1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9":
			payload["aspect_ratio"] = ratio
		default:
			return nil, nil, "", unsupported()
		}
	}
	if len(spec.GetReferenceImages()) > 0 {
		refs := make([]map[string]any, 0, len(spec.GetReferenceImages()))
		for _, ref := range spec.GetReferenceImages() {
			if strings.TrimSpace(ref) == "" {
				return nil, nil, "", unsupported()
			}
			refs = append(refs, map[string]any{"type": "character", "image_file": ref})
		}
		payload["subject_reference"] = refs
	}
	response := map[string]any{}
	if format == "url" {
		ctx = originalControlRequest(ctx)
	}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(cfg.BaseURL, "/v1/image_generation"), cfg.APIKey, payload, &response, cfg.Headers); err != nil {
		return nil, nil, "", err
	}
	base, ok := response["base_resp"].(map[string]any)
	if !ok {
		return nil, nil, "", invalid()
	}
	status, err := strictMiniMaxCount(base["status_code"])
	if err != nil {
		return nil, nil, "", invalid()
	}
	if status != 0 {
		return nil, nil, "", MapProviderHTTPError(http.StatusBadRequest, response)
	}
	data, ok := response["data"].(map[string]any)
	if !ok {
		return nil, nil, "", invalid()
	}
	key := "image_urls"
	if format == "base64" {
		key = "image_base64"
	}
	values, ok := data[key].([]any)
	if !ok || len(values) != int(n) {
		return nil, nil, "", invalid()
	}
	if metadata, ok := response["metadata"].(map[string]any); ok {
		for key, want := range map[string]int{"success_count": int(n), "failed_count": 0} {
			if value, present := metadata[key]; present {
				count, err := strictMiniMaxCount(value)
				if err != nil || count != want {
					return nil, nil, "", invalid()
				}
			}
		}
	}
	artifacts := make([]*runtimev1.ScenarioArtifact, 0, n)
	for _, value := range values {
		raw, ok := value.(string)
		if !ok || strings.TrimSpace(raw) == "" {
			return nil, nil, "", invalid()
		}
		artifact := BinaryArtifact("image/jpeg", nil, map[string]any{"adapter": AdapterMiniMaxTask})
		if format == "base64" {
			body, err := base64.StdEncoding.Strict().DecodeString(raw)
			if err != nil || len(body) == 0 {
				return nil, nil, "", invalid()
			}
			artifact = BinaryArtifact(http.DetectContentType(body), body, map[string]any{"adapter": AdapterMiniMaxTask})
			if !isImageArtifactMIME(artifact.MimeType) {
				return nil, nil, "", invalid()
			}
		} else {
			artifact.Uri = raw
		}
		ApplyImageSpecMetadata(artifact, spec)
		artifacts = append(artifacts, artifact)
	}
	return artifacts, nil, "", nil
}
func strictMiniMaxCount(value any) (int, error) {
	switch v := value.(type) {
	case float64:
		if v < 0 || v > 1<<31 || v != float64(int(v)) {
			return 0, fmt.Errorf("invalid MiniMax count")
		}
		return int(v), nil
	case string:
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return 0, fmt.Errorf("invalid MiniMax count")
		}
		return n, nil
	}
	return 0, fmt.Errorf("invalid MiniMax count")
}
