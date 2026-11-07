package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func seedreamOutputError() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

func seedreamNativeFailure(raw json.RawMessage) error {
	var native map[string]any
	if json.Unmarshal(raw, &native) != nil || len(native) == 0 {
		return seedreamOutputError()
	}
	return providerTaskFailedError("failed", map[string]any{"error": native})
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func ExecuteSeedreamImage(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	b, err := nativeMediaBackend(ctx, cfg, "volcengine")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetImageGenerate()
	body := map[string]any{"model": model, "prompt": s.GetPrompt(), "size": s.GetSize(), "response_format": s.GetResponseFormat()}
	if model != capabilitydriver.Seedream45Model {
		body["output_format"] = s.GetOutputFormat()
	}
	if !capabilitydriver.SeedreamProFlash(model) {
		body["sequential_image_generation"] = "disabled"
		body["stream"] = false
	}
	refs := append([]string(nil), s.GetReferenceImages()...)
	if s.GetReferenceImageArtifactId() != "" {
		ref, _ := ctx.Value(imageReferenceContextKey{}).(*CapturedMediaReference)
		if ref == nil || ref.ArtifactID != s.GetReferenceImageArtifactId() {
			return nil, nil, "", seedreamOutputError()
		}
		refs = append(refs, "data:"+ref.MIMEType+";base64,"+base64.StdEncoding.EncodeToString(ref.Bytes))
	}
	if len(refs) > 0 {
		body["image"] = refs
	}
	encoded, err := json.Marshal(body)
	if err != nil || len(encoded) > 64_000_000 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/images/generations", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	raw, err := readLimitedResponseBody(response.Body, 128<<20)
	if err != nil {
		return nil, nil, "", err
	}
	var out struct {
		Model string          `json:"model"`
		Error json.RawMessage `json:"error"`
		Data  []struct {
			URL    string          `json:"url"`
			Base64 string          `json:"b64_json"`
			Size   string          `json:"size"`
			Format string          `json:"output_format"`
			Error  json.RawMessage `json:"error"`
		} `json:"data"`
		Usage *struct {
			Images *int64 `json:"generated_images"`
			Output *int64 `json:"output_tokens"`
			Total  *int64 `json:"total_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(raw, &out) != nil {
		return nil, nil, "", seedreamOutputError()
	}
	if out.Model != "" && out.Model != model && !(model == capabilitydriver.Seedream5Model && out.Model == "doubao-seedream-5-0-lite-260128") {
		return nil, nil, "", seedreamOutputError()
	}
	if len(out.Error) > 0 && string(out.Error) != "null" {
		return nil, nil, "", seedreamNativeFailure(out.Error)
	}
	if len(out.Data) != 1 {
		return nil, nil, "", seedreamOutputError()
	}
	item := out.Data[0]
	if len(item.Error) > 0 && string(item.Error) != "null" {
		return nil, nil, "", seedreamNativeFailure(item.Error)
	}
	var data []byte
	if s.GetResponseFormat() == "b64_json" {
		data, err = base64.StdEncoding.Strict().DecodeString(item.Base64)
		if err != nil || len(data) == 0 {
			return nil, nil, "", seedreamOutputError()
		}
	} else {
		if item.URL == "" {
			return nil, nil, "", seedreamOutputError()
		}
		// The artifact origin receives no Connector credential. The actual
		// decoded image, not a URL suffix or requested size, owns output facts.
		data, _, err = fetchBinaryArtifact(ctx, item.URL)
		if err != nil {
			return nil, nil, "", err
		}
	}
	geometry, format, ok := decodedMediaImageConfig(data)
	if !ok || format != s.GetOutputFormat() || !capabilitydriver.SeedreamImageGeometryAllowed(model, geometry.Width, geometry.Height) {
		return nil, nil, "", seedreamOutputError()
	}
	if w, h, exact := capabilitydriver.SeedreamImageDimensions(s.GetSize()); exact && (geometry.Width != w || geometry.Height != h) {
		return nil, nil, "", seedreamOutputError()
	}
	if item.Size != "" {
		w, h, valid := capabilitydriver.SeedreamImageDimensions(item.Size)
		if !valid || w != geometry.Width || h != geometry.Height {
			return nil, nil, "", seedreamOutputError()
		}
	}
	if item.Format != "" && item.Format != format {
		return nil, nil, "", seedreamOutputError()
	}
	var usage *runtimev1.UsageStats
	if u := out.Usage; u != nil {
		if u.Images != nil && *u.Images != 1 || u.Output != nil && *u.Output < 0 || u.Total != nil && *u.Total < 0 || u.Output != nil && u.Total != nil && *u.Output != *u.Total {
			return nil, nil, "", seedreamOutputError()
		}
		if u.Output != nil {
			usage = &runtimev1.UsageStats{OutputTokens: *u.Output}
		}
	}
	a := BinaryArtifact("image/"+format, data, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterSeedreamImage})
	a.Width, a.Height = int32(geometry.Width), int32(geometry.Height)
	return []*runtimev1.ScenarioArtifact{a}, usage, "", nil
}
