package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func siliconFlowOutputError() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
func ExecuteSiliconFlowImage(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	b, err := nativeMediaBackend(ctx, cfg, "siliconflow")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetImageGenerate()
	body := map[string]any{"model": model, "prompt": s.GetPrompt()}
	if s.GetSize() != "" {
		body["image_size"] = s.GetSize()
	}
	if s.GetNegativePrompt() != "" {
		body["negative_prompt"] = s.GetNegativePrompt()
	}
	if s.Seed != nil {
		body["seed"] = s.GetSeed()
	}
	if s.GetReferenceImageArtifactId() != "" {
		ref, _ := ctx.Value(imageReferenceContextKey{}).(*CapturedMediaReference)
		if ref == nil || ref.ArtifactID != s.GetReferenceImageArtifactId() {
			return nil, nil, "", siliconFlowOutputError()
		}
		body["image"] = "data:" + ref.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(ref.Bytes)
	} else {
		keys := []string{"image", "image2", "image3"}
		for i, uri := range s.GetReferenceImages() {
			body[keys[i]] = uri
		}
	}
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/images/generations", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer response.Body.Close()
	var out struct {
		Images []struct {
			URL string `json:"url"`
		} `json:"images"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, nil, "", err
	}
	if len(out.Images) != 1 || out.Images[0].URL == "" {
		return nil, nil, "", siliconFlowOutputError()
	}
	// The returned URL never receives API credentials. Validate the whole image
	// before publishing, and let the served bytes determine the actual MIME.
	data, _, err := fetchBinaryArtifact(ctx, out.Images[0].URL)
	if err != nil {
		return nil, nil, "", err
	}
	geometry, format, ok := decodedMediaImageConfig(data)
	if !ok {
		return nil, nil, "", siliconFlowOutputError()
	}
	if s.GetSize() != "" {
		w, h, _ := capabilitydriver.SiliconFlowImageDimensions(s.GetSize())
		if geometry.Width != w || geometry.Height != h {
			return nil, nil, "", siliconFlowOutputError()
		}
	}
	return []*runtimev1.ScenarioArtifact{BinaryArtifact("image/"+format, data, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterSiliconFlowImage})}, nil, "", nil
}
func ExecuteSiliconFlowSpeech(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "siliconflow")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetSpeechSynthesize()
	body := map[string]any{"model": model, "input": s.GetText(), "voice": s.GetVoiceRef().GetPresetVoiceId(), "response_format": s.GetAudioFormat(), "sample_rate": s.GetSampleRateHz(), "stream": false}
	if s.Speed != nil {
		body["speed"] = s.GetSpeed()
	}
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/audio/speech", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer response.Body.Close()
	data, err := readLimitedResponseBody(response.Body, 32<<20)
	if err != nil {
		return nil, nil, "", err
	}
	a, err := nativeSpeechArtifact(ctx, data, s.GetAudioFormat(), s.GetSampleRateHz(), map[string]any{"adapter": capabilitydriver.CloudMediaAdapterSiliconFlowSpeech})
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{a}, nil, "", nil
}
