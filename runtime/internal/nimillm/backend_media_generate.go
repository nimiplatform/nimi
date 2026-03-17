package nimillm

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (b *Backend) generateImageMedia(
	ctx context.Context,
	modelID string,
	spec *runtimev1.ImageGenerateScenarioSpec,
	scenarioExtensions map[string]any,
) ([]byte, *runtimev1.UsageStats, error) {
	type imageSpec struct {
		Prompt          string         `json:"prompt"`
		NegativePrompt  string         `json:"negative_prompt,omitempty"`
		N               int32          `json:"n,omitempty"`
		Size            string         `json:"size,omitempty"`
		AspectRatio     string         `json:"aspect_ratio,omitempty"`
		Quality         string         `json:"quality,omitempty"`
		Style           string         `json:"style,omitempty"`
		Seed            int64          `json:"seed,omitempty"`
		ReferenceImages []string       `json:"reference_images,omitempty"`
		Mask            string         `json:"mask,omitempty"`
		ResponseFormat  string         `json:"response_format,omitempty"`
		Extensions      map[string]any `json:"extensions,omitempty"`
	}
	type imageRequest struct {
		Model string    `json:"model"`
		Spec  imageSpec `json:"spec"`
	}
	type imageResponse struct {
		Artifact struct {
			MIMEType   string `json:"mime_type"`
			DataBase64 string `json:"data_base64"`
			URL        string `json:"url"`
		} `json:"artifact"`
	}

	prompt := ""
	if spec != nil {
		prompt = strings.TrimSpace(spec.GetPrompt())
	}
	responseFormat := "b64_json"
	if spec != nil {
		normalizedFormat, err := normalizeImageResponseFormat(spec.GetResponseFormat())
		if err != nil {
			return nil, nil, err
		}
		responseFormat = normalizedFormat
	}

	var respBody imageResponse
	if err := b.postJSON(ctx, "/v1/media/image/generate", imageRequest{
		Model: modelID,
		Spec: imageSpec{
			Prompt:          prompt,
			NegativePrompt:  strings.TrimSpace(spec.GetNegativePrompt()),
			N:               spec.GetN(),
			Size:            strings.TrimSpace(spec.GetSize()),
			AspectRatio:     strings.TrimSpace(spec.GetAspectRatio()),
			Quality:         strings.TrimSpace(spec.GetQuality()),
			Style:           strings.TrimSpace(spec.GetStyle()),
			Seed:            spec.GetSeed(),
			ReferenceImages: append([]string(nil), spec.GetReferenceImages()...),
			Mask:            strings.TrimSpace(spec.GetMask()),
			ResponseFormat:  responseFormat,
			Extensions:      scenarioExtensions,
		},
	}, &respBody); err != nil {
		return nil, nil, err
	}

	payload, err := b.DecodeMedia(ctx, respBody.Artifact.DataBase64, respBody.Artifact.URL)
	if err != nil {
		return nil, nil, err
	}
	usage := ArtifactUsage(prompt, payload, 180)
	return payload, usage, nil
}

func (b *Backend) generateVideoMedia(
	ctx context.Context,
	modelID string,
	spec *runtimev1.VideoGenerateScenarioSpec,
	scenarioExtensions map[string]any,
) ([]byte, *runtimev1.UsageStats, error) {
	type videoSpec struct {
		Prompt                   string           `json:"prompt"`
		NegativePrompt           string           `json:"negative_prompt,omitempty"`
		Mode                     string           `json:"mode,omitempty"`
		Content                  []map[string]any `json:"content,omitempty"`
		DurationSec              int32            `json:"duration_sec,omitempty"`
		Frames                   int32            `json:"frames,omitempty"`
		Fps                      int32            `json:"fps,omitempty"`
		Resolution               string           `json:"resolution,omitempty"`
		AspectRatio              string           `json:"aspect_ratio,omitempty"`
		Seed                     int64            `json:"seed,omitempty"`
		CameraFixed              bool             `json:"camera_fixed,omitempty"`
		Watermark                bool             `json:"watermark,omitempty"`
		GenerateAudio            bool             `json:"generate_audio,omitempty"`
		Draft                    bool             `json:"draft,omitempty"`
		ServiceTier              string           `json:"service_tier,omitempty"`
		ExecutionExpiresAfterSec int32            `json:"execution_expires_after_sec,omitempty"`
		ReturnLastFrame          bool             `json:"return_last_frame,omitempty"`
		Extensions               map[string]any   `json:"extensions,omitempty"`
	}
	type videoRequest struct {
		Model string    `json:"model"`
		Spec  videoSpec `json:"spec"`
	}
	type videoResponse struct {
		Artifact struct {
			MIMEType   string `json:"mime_type"`
			DataBase64 string `json:"data_base64"`
			URL        string `json:"url"`
		} `json:"artifact"`
	}

	prompt := VideoPrompt(spec)
	mode := ""
	if spec != nil {
		mode = strings.ToLower(strings.TrimPrefix(spec.GetMode().String(), "VIDEO_MODE_"))
	}
	content := VideoContentPayload(spec)

	var respBody videoResponse
	if err := b.postJSON(ctx, "/v1/media/video/generate", videoRequest{
		Model: modelID,
		Spec: videoSpec{
			Prompt:                   prompt,
			NegativePrompt:           VideoNegativePrompt(spec),
			Mode:                     mode,
			Content:                  content,
			DurationSec:              VideoDurationSec(spec),
			Frames:                   VideoFrames(spec),
			Fps:                      VideoFPS(spec),
			Resolution:               VideoResolution(spec),
			AspectRatio:              VideoRatio(spec),
			Seed:                     VideoSeed(spec),
			CameraFixed:              VideoCameraFixed(spec),
			Watermark:                VideoWatermark(spec),
			GenerateAudio:            VideoGenerateAudio(spec),
			Draft:                    VideoDraft(spec),
			ServiceTier:              VideoServiceTier(spec),
			ExecutionExpiresAfterSec: VideoExecutionExpiresAfterSec(spec),
			ReturnLastFrame:          VideoReturnLastFrame(spec),
			Extensions:               scenarioExtensions,
		},
	}, &respBody); err != nil {
		return nil, nil, err
	}

	payload, err := b.DecodeMedia(ctx, respBody.Artifact.DataBase64, respBody.Artifact.URL)
	if err != nil {
		return nil, nil, err
	}
	usage := ArtifactUsage(prompt, payload, 420)
	return payload, usage, nil
}
