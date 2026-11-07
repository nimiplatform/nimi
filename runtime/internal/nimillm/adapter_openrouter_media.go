package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"net/http"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const AdapterOpenRouterVideo = capabilitydriver.CloudMediaAdapterOpenRouterVideo
const openRouterVideoQueryPath = "/v1/videos/{task_id}"

func openRouterOutputError() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

type openRouterUsage struct {
	Input        *int64 `json:"prompt_tokens"`
	Output       *int64 `json:"completion_tokens"`
	Total        *int64 `json:"total_tokens"`
	NativeInput  *int64 `json:"input_tokens"`
	NativeOutput *int64 `json:"output_tokens"`
}

func (u *openRouterUsage) stats() (*runtimev1.UsageStats, error) {
	if u == nil {
		return nil, nil
	}
	if u.NativeInput != nil {
		if u.Input != nil && *u.Input != *u.NativeInput {
			return nil, openRouterOutputError()
		}
		u.Input = u.NativeInput
	}
	if u.NativeOutput != nil {
		if u.Output != nil && *u.Output != *u.NativeOutput {
			return nil, openRouterOutputError()
		}
		u.Output = u.NativeOutput
	}
	if u.Input != nil && *u.Input < 0 || u.Output != nil && *u.Output < 0 || u.Total != nil && *u.Total < 0 {
		return nil, openRouterOutputError()
	}
	if u.Input == nil {
		return nil, nil
	}
	if u.Output != nil {
		return &runtimev1.UsageStats{InputTokens: *u.Input, OutputTokens: *u.Output}, nil
	}
	if u.Total != nil {
		if *u.Total < *u.Input {
			return nil, openRouterOutputError()
		}
		return &runtimev1.UsageStats{InputTokens: *u.Input, OutputTokens: *u.Total - *u.Input}, nil
	}
	return nil, nil
}

func ExecuteOpenRouterImage(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "openrouter")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetImageGenerate()
	body := map[string]any{"model": model, "prompt": s.GetPrompt(), "n": s.GetN()}
	if s.GetSize() != "" && s.GetSize() != "auto" {
		if model == "google/gemini-nano-banana-2.1" {
			body["resolution"] = s.GetSize()
		} else {
			body["size"] = s.GetSize()
		}
	}
	if s.GetAspectRatio() != "" {
		body["aspect_ratio"] = s.GetAspectRatio()
	}
	if s.GetComplexity() != "" {
		body["provider"] = map[string]any{"options": map[string]any{"openai": map[string]any{"complexity": s.GetComplexity()}}}
	}
	if s.GetQuality() != "" {
		body["quality"] = s.GetQuality()
	}
	if s.GetOutputFormat() != "" {
		body["output_format"] = s.GetOutputFormat()
	}
	if s.GetReferenceImageArtifactId() != "" {
		ref, _ := ctx.Value(imageReferenceContextKey{}).(*CapturedMediaReference)
		if ref == nil || ref.ArtifactID != s.GetReferenceImageArtifactId() {
			return nil, nil, "", openRouterOutputError()
		}
		body["input_references"] = []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + ref.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(ref.Bytes)}}}
	}
	resp, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/images", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer func(cleanup func() error) { _ = cleanup() }(resp.Body.Close)
	raw, err := readLimitedResponseBody(resp.Body, 256<<20)
	if err != nil {
		return nil, nil, "", err
	}
	var out struct {
		Data []struct {
			Data string `json:"b64_json"`
			MIME string `json:"media_type"`
		} `json:"data"`
		Usage *openRouterUsage `json:"usage"`
	}
	if json.Unmarshal(raw, &out) != nil || len(out.Data) != int(s.GetN()) {
		return nil, nil, "", openRouterOutputError()
	}
	artifacts := []*runtimev1.ScenarioArtifact{}
	for _, entry := range out.Data {
		data, err := base64.StdEncoding.Strict().DecodeString(entry.Data)
		if err != nil || len(data) == 0 {
			return nil, nil, "", openRouterOutputError()
		}
		g, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || g.Width <= 0 || g.Height <= 0 || g.Width > 16384 || g.Height > 16384 || g.Width*g.Height > 64<<20 {
			return nil, nil, "", openRouterOutputError()
		}
		mime := "image/" + format
		if mime != "image/png" && mime != "image/jpeg" && mime != "image/webp" || entry.MIME != "" && entry.MIME != mime || s.GetOutputFormat() != "" && s.GetOutputFormat() != format {
			return nil, nil, "", openRouterOutputError()
		}
		if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
			return nil, nil, "", openRouterOutputError()
		}
		a := BinaryArtifact(mime, data, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterOpenRouterImage})
		artifacts = append(artifacts, a)
	}
	usage, err := out.Usage.stats()
	return artifacts, usage, "", err
}

func ExecuteOpenRouterSpeech(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "openrouter")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetSpeechSynthesize()
	resp, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/audio/speech", map[string]any{"model": model, "input": s.GetText(), "voice": s.GetVoiceRef().GetPresetVoiceId(), "response_format": "mp3"})
	if err != nil {
		return nil, nil, "", err
	}
	defer func(cleanup func() error) { _ = cleanup() }(resp.Body.Close)
	data, err := readLimitedResponseBody(resp.Body, 32<<20)
	if err != nil {
		return nil, nil, "", err
	}
	a, err := nativeSpeechArtifact(ctx, data, "mp3", 0, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterOpenRouterSpeech})
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{a}, nil, "", nil
}
