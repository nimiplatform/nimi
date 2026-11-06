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

func togetherOutputError() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
func ExecuteTogetherImage(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "together")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetImageGenerate()
	width, height, _ := capabilitydriver.TogetherImageDimensions(s.GetSize())
	body := map[string]any{"model": model, "prompt": s.GetPrompt(), "n": s.GetN(), "width": width, "height": height, "response_format": "base64", "output_format": s.GetOutputFormat()}
	if s.Seed != nil {
		body["seed"] = s.GetSeed()
	}
	if len(s.GetReferenceImages()) > 0 {
		body["reference_images"] = s.GetReferenceImages()
	}
	resp, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/images/generations", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer resp.Body.Close()
	raw, err := readLimitedResponseBody(resp.Body, 128<<20)
	if err != nil {
		return nil, nil, "", err
	}
	var out struct {
		Model string `json:"model"`
		Data  []struct {
			Index *int   `json:"index"`
			Type  string `json:"type"`
			Data  string `json:"b64_json"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &out) != nil || out.Model != model || len(out.Data) != int(s.GetN()) {
		return nil, nil, "", togetherOutputError()
	}
	artifacts := make([]*runtimev1.ScenarioArtifact, len(out.Data))
	for _, item := range out.Data {
		if item.Index == nil || *item.Index < 0 || *item.Index >= len(artifacts) || artifacts[*item.Index] != nil || item.Type != "b64_json" {
			return nil, nil, "", togetherOutputError()
		}
		data, err := base64.StdEncoding.Strict().DecodeString(item.Data)
		if err != nil || len(data) == 0 {
			return nil, nil, "", togetherOutputError()
		}
		geometry, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || geometry.Width != width || geometry.Height != height || format != s.GetOutputFormat() {
			return nil, nil, "", togetherOutputError()
		}
		if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
			return nil, nil, "", togetherOutputError()
		}
		artifacts[*item.Index] = BinaryArtifact("image/"+format, data, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterTogetherImage})
	}
	return artifacts, nil, "", nil
}
func ExecuteTogetherSpeech(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "together")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetSpeechSynthesize()
	body := map[string]any{"model": model, "input": s.GetText(), "voice": s.GetVoiceRef().GetPresetVoiceId(), "language": s.GetLanguage(), "response_format": s.GetAudioFormat(), "sample_rate": s.GetSampleRateHz(), "stream": false, "alignment": "none"}
	resp, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/audio/speech", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer resp.Body.Close()
	data, err := readLimitedResponseBody(resp.Body, 32<<20)
	if err != nil {
		return nil, nil, "", err
	}
	a, err := nativeSpeechArtifact(ctx, data, s.GetAudioFormat(), s.GetSampleRateHz(), map[string]any{"adapter": capabilitydriver.CloudMediaAdapterTogetherSpeech})
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{a}, nil, "", nil
}
