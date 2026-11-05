package nimillm

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const ideogram45QueryPath = "/v2/generations/{task_id}"

// @nimi-authority: rule.nimi.runtime.ai-provider.ideogram45-image
func executeIdeogram45Image(ctx context.Context, cfg MediaAdapterConfig, s *runtimev1.ImageGenerateScenarioSpec) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	ctx = originalControlRequest(ctx)
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	fields := map[string]any{"prompt": s.GetPrompt(), "async": true}
	if s.GetSize() != "" {
		fields["size"] = s.GetSize()
	}
	if s.GetQuality() != "" {
		fields["quality"] = s.GetQuality()
	}
	if s.Seed != nil {
		fields["seed"] = s.GetSeed()
	}
	if s.GetN() > 0 {
		fields["num_images"] = s.GetN()
	}
	headers := cloneMediaHeaders(cfg.Headers)
	if headers == nil {
		headers = map[string]string{}
	}
	headers["Api-Key"] = key
	endpoint := JoinURL(ideogramV2BaseURL(cfg.BaseURL), "/v2/image/generate/"+capabilitydriver.Ideogram45Model)
	response := map[string]any{}
	if s.GetReferenceImageArtifactId() == "" && len(s.GetReferenceImages()) == 0 {
		err = DoJSONRequestWithHeaders(nativeCreateRequest(ctx), http.MethodPost, endpoint, "", fields, &response, headers)
	} else {
		var body []byte
		var contentType string
		body, contentType, err = ideogram45Multipart(ctx, s, fields)
		if err == nil {
			err = postIdeogram45Multipart(nativeCreateRequest(ctx), endpoint, body, contentType, headers, &response)
		}
	}
	if err != nil {
		return nil, nil, "", err
	}
	id := ValueAsString(response["generation_id"])
	kind := ValueAsString(response["generation_kind"])
	if id == "" || (kind != "sampling" && kind != "workflow") {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	artifact := BinaryArtifact("image/png", nil, map[string]any{"adapter": AdapterIdeogramNative})
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterIdeogramNative, TaskID: id, Model: capabilitydriver.Ideogram45Model, QueryPathTemplate: ideogram45QueryPath, Artifact: artifact})
	return nil, nil, id, err
}

func ideogramV2BaseURL(raw string) string {
	// The v2 root is the only documented service suffix for this exact protocol.
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return raw
	}
	u.Path = strings.TrimSuffix(strings.TrimRight(u.Path, "/"), "/v2")
	if u.RawPath != "" {
		u.RawPath = strings.TrimSuffix(strings.TrimRight(u.RawPath, "/"), "/v2")
	}
	return u.String()
}

func ideogram45Multipart(ctx context.Context, s *runtimev1.ImageGenerateScenarioSpec, fields map[string]any) ([]byte, string, error) {
	type source struct {
		data []byte
		mime string
	}
	images := []source{}
	if s.GetReferenceImageArtifactId() != "" {
		r, _ := ctx.Value(imageReferenceContextKey{}).(*CapturedMediaReference)
		if r == nil || r.ArtifactID != s.GetReferenceImageArtifactId() {
			return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		images = append(images, source{r.Bytes, r.MIMEType})
	} else {
		for _, uri := range s.GetReferenceImages() {
			data, _, err := resolveReferenceImageBytes(ctx, uri)
			if err != nil {
				return nil, "", err
			}
			mime := http.DetectContentType(data)
			if _, err = decodeIdeogram45Image(data, mime); err != nil {
				return nil, "", err
			}
			images = append(images, source{data, mime})
		}
	}
	var mask []byte
	var err error
	if s.GetMaskArtifactId() != "" || s.GetMask() != "" {
		var data []byte
		mime := ""
		if s.GetMaskArtifactId() != "" {
			r, _ := ctx.Value(imageMaskReferenceContextKey{}).(*CapturedMediaReference)
			if r == nil || r.ArtifactID != s.GetMaskArtifactId() {
				return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
			}
			data, mime = r.Bytes, r.MIMEType
		} else {
			data, _, err = resolveReferenceImageBytes(ctx, s.GetMask())
			if err != nil {
				return nil, "", err
			}
			mime = http.DetectContentType(data)
		}
		c, _, decodeErr := image.DecodeConfig(bytes.NewReader(images[0].data))
		if decodeErr != nil {
			return nil, "", decodeErr
		}
		mask, err = ideogram45NativeMask(image.Rect(0, 0, c.Width, c.Height), data, mime)
		if err != nil {
			return nil, "", err
		}
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for k, v := range fields {
		if err := writer.WriteField(k, fmt.Sprint(v)); err != nil {
			return nil, "", err
		}
	}
	for i, r := range images {
		if err := writeMediaImagePart(writer, "images", fmt.Sprintf("source-%d.%s", i, strings.TrimPrefix(r.mime, "image/")), r.mime, r.data); err != nil {
			return nil, "", err
		}
	}
	if mask != nil {
		if err := writeMediaImagePart(writer, "mask", "mask.png", "image/png", mask); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return body.Bytes(), writer.FormDataContentType(), nil
}

func postIdeogram45Multipart(ctx context.Context, endpoint string, body []byte, contentType string, headers map[string]string, target *map[string]any) error {
	client, req, err := newSecuredHTTPRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Accept", "application/json")
	applyProviderRequestHeaders(req, headers)
	response, err := client.Do(req)
	if err != nil {
		return markNativeCreateResponseUnavailable(ctx, MapProviderRequestError(err))
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, err := providerHTTPErrorFromResponse(response, endpoint)
		return err
	}
	if err := decodeProviderJSONResponse(ctx, response.Body, target); err != nil {
		return markNativeCreateResponseUnavailable(ctx, providerResponseDecodeError(err))
	}
	return nil
}

func observeIdeogram45Image(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	headers := cloneMediaHeaders(cfg.Headers)
	if headers == nil {
		headers = map[string]string{}
	}
	headers["Api-Key"] = cfg.APIKey
	response := map[string]any{}
	err := DoJSONRequestWithHeaders(ctx, http.MethodGet, JoinURL(ideogramV2BaseURL(cfg.BaseURL), ResolveTaskQueryPath(r.QueryPathTemplate, r.TaskID)), "", nil, &response, headers)
	if err != nil {
		return nil, false, err
	}
	invalid := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	if ValueAsString(response["generation_id"]) != r.TaskID {
		return nil, false, invalid
	}
	switch ValueAsString(response["status"]) {
	case "pending":
		return nil, false, nil
	case "failed":
		if ValueAsString(response["failure_reason"]) == "content_policy_violation" {
			return nil, true, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
		}
		return nil, true, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	case "completed":
	default:
		return nil, false, invalid
	}
	data, ok := response["data"].([]any)
	if !ok || len(data) == 0 || len(data) > 4 || ValueAsString(response["response_type"]) != "url" {
		return nil, false, invalid
	}
	result := &NativeTaskObservation{}
	for index, item := range data {
		row, ok := item.(map[string]any)
		if !ok || ValueAsString(row["object_type"]) != "" {
			return nil, false, invalid
		}
		safe, ok := row["is_image_safe"].(bool)
		if !ok {
			return nil, false, invalid
		}
		if !safe {
			return nil, true, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
		}
		uri := ValueAsString(row["url"])
		if !validNativeVideoArtifactURL(uri) {
			return nil, false, invalid
		}
		artifact := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
		if index > 0 {
			artifact.ArtifactId += "-" + strconv.Itoa(index)
		}
		artifact.Uri = uri
		artifact.SizeBytes = 0
		artifact.Sha256 = ""
		// Reported resolution is an output fact, never a requested nominal tier.
		artifact.Width, artifact.Height = ParseDimensionPair(ValueAsString(row["resolution"]))
		result.Artifacts = append(result.Artifacts, artifact)
	}
	return result, true, nil
}
