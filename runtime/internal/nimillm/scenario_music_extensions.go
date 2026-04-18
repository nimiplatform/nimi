package nimillm

import (
	"encoding/base64"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

type MusicIterationMode string

const (
	MusicIterationModeExtend    MusicIterationMode = "extend"
	MusicIterationModeRemix     MusicIterationMode = "remix"
	MusicIterationModeReference MusicIterationMode = "reference"
)

type MusicIterationExtension struct {
	Mode              MusicIterationMode
	SourceAudioBase64 string
	SourceMIMEType    string
	TrimStartSec      float64
	TrimEndSec        float64
	HasTrimStartSec   bool
	HasTrimEndSec     bool
}

var allowedMusicIterationKeys = map[string]struct{}{
	"mode":                {},
	"source_audio_base64": {},
	"source_mime_type":    {},
	"trim_start_sec":      {},
	"trim_end_sec":        {},
}

func NormalizeMusicIterationExtension(payload map[string]any) (map[string]any, *MusicIterationExtension, error) {
	if len(payload) == 0 {
		return nil, nil, nil
	}

	out := make(map[string]any, len(payload))
	iteration := &MusicIterationExtension{}

	for key, value := range payload {
		normalizedKey := strings.TrimSpace(key)
		if normalizedKey == "" {
			return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if _, ok := allowedMusicIterationKeys[normalizedKey]; !ok {
			return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}

		switch normalizedKey {
		case "mode":
			mode, err := normalizeMusicIterationMode(value)
			if err != nil {
				return nil, nil, err
			}
			iteration.Mode = mode
			out[normalizedKey] = string(mode)
		case "source_audio_base64":
			sourceAudio := strings.TrimSpace(ValueAsString(value))
			if sourceAudio == "" {
				return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
			}
			if _, err := decodeMusicIterationBase64(sourceAudio); err != nil {
				return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
			}
			iteration.SourceAudioBase64 = sourceAudio
			out[normalizedKey] = sourceAudio
		case "source_mime_type":
			mimeType := strings.TrimSpace(ValueAsString(value))
			if mimeType != "" {
				iteration.SourceMIMEType = mimeType
				out[normalizedKey] = mimeType
			}
		case "trim_start_sec":
			trimStartSec, err := normalizeMusicIterationSecondValue(value)
			if err != nil {
				return nil, nil, err
			}
			iteration.TrimStartSec = trimStartSec
			iteration.HasTrimStartSec = true
			out[normalizedKey] = trimStartSec
		case "trim_end_sec":
			trimEndSec, err := normalizeMusicIterationSecondValue(value)
			if err != nil {
				return nil, nil, err
			}
			iteration.TrimEndSec = trimEndSec
			iteration.HasTrimEndSec = true
			out[normalizedKey] = trimEndSec
		}
	}

	if iteration.Mode == "" || iteration.SourceAudioBase64 == "" {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if iteration.HasTrimStartSec && iteration.HasTrimEndSec && iteration.TrimEndSec <= iteration.TrimStartSec {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}

	return out, iteration, nil
}

func (extension *MusicIterationExtension) CanonicalPayload() map[string]any {
	if extension == nil {
		return nil
	}
	payload := map[string]any{
		"mode":                string(extension.Mode),
		"source_audio_base64": extension.SourceAudioBase64,
	}
	if strings.TrimSpace(extension.SourceMIMEType) != "" {
		payload["source_mime_type"] = strings.TrimSpace(extension.SourceMIMEType)
	}
	if extension.HasTrimStartSec {
		payload["trim_start_sec"] = extension.TrimStartSec
	}
	if extension.HasTrimEndSec {
		payload["trim_end_sec"] = extension.TrimEndSec
	}
	return payload
}

type musicGenerationStrategy interface {
	SupportsIteration() bool
	BuildRequest(modelID string, spec *runtimev1.MusicGenerateScenarioSpec, iteration *MusicIterationExtension) (map[string]any, error)
}

type defaultMusicGenerationStrategy struct{}

func (defaultMusicGenerationStrategy) SupportsIteration() bool {
	return false
}

func (defaultMusicGenerationStrategy) BuildRequest(modelID string, spec *runtimev1.MusicGenerateScenarioSpec, iteration *MusicIterationExtension) (map[string]any, error) {
	if iteration != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return buildBaseMusicGenerationRequest(modelID, spec), nil
}

type stabilityMusicGenerationStrategy struct{}

func (stabilityMusicGenerationStrategy) SupportsIteration() bool {
	return true
}

func (stabilityMusicGenerationStrategy) BuildRequest(modelID string, spec *runtimev1.MusicGenerateScenarioSpec, iteration *MusicIterationExtension) (map[string]any, error) {
	request := buildBaseMusicGenerationRequest(modelID, spec)
	if iteration != nil {
		request["extensions"] = iteration.CanonicalPayload()
	}
	return request, nil
}

func SupportsMusicGenerationIterationStrategy(name string) bool {
	return resolveMusicGenerationStrategy(name).SupportsIteration()
}

func buildMusicGenerationRequest(
	backendName string,
	modelID string,
	spec *runtimev1.MusicGenerateScenarioSpec,
	scenarioExtensions map[string]any,
) (map[string]any, error) {
	_, iteration, err := NormalizeMusicIterationExtension(scenarioExtensions)
	if err != nil {
		return nil, err
	}
	return resolveMusicGenerationStrategy(backendName).BuildRequest(modelID, spec, iteration)
}

func buildBaseMusicGenerationRequest(modelID string, spec *runtimev1.MusicGenerateScenarioSpec) map[string]any {
	return map[string]any{
		"model":            modelID,
		"prompt":           strings.TrimSpace(spec.GetPrompt()),
		"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
		"lyrics":           strings.TrimSpace(spec.GetLyrics()),
		"style":            strings.TrimSpace(spec.GetStyle()),
		"title":            strings.TrimSpace(spec.GetTitle()),
		"duration_seconds": spec.GetDurationSeconds(),
		"instrumental":     spec.GetInstrumental(),
	}
}

func resolveMusicGenerationStrategy(name string) musicGenerationStrategy {
	switch normalizeMusicStrategyName(name) {
	case "stability":
		return stabilityMusicGenerationStrategy{}
	default:
		return defaultMusicGenerationStrategy{}
	}
}

func normalizeMusicStrategyName(value string) string {
	name := strings.ToLower(strings.TrimSpace(value))
	switch {
	case strings.HasPrefix(name, "cloud-"):
		return strings.TrimPrefix(name, "cloud-")
	case strings.HasPrefix(name, "local-"):
		return strings.TrimPrefix(name, "local-")
	default:
		return name
	}
}

func normalizeMusicIterationMode(value any) (MusicIterationMode, error) {
	switch MusicIterationMode(strings.ToLower(strings.TrimSpace(ValueAsString(value)))) {
	case MusicIterationModeExtend:
		return MusicIterationModeExtend, nil
	case MusicIterationModeRemix:
		return MusicIterationModeRemix, nil
	case MusicIterationModeReference:
		return MusicIterationModeReference, nil
	default:
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
}

func normalizeMusicIterationSecondValue(value any) (float64, error) {
	var parsed float64
	switch item := value.(type) {
	case int:
		parsed = float64(item)
	case int32:
		parsed = float64(item)
	case int64:
		parsed = float64(item)
	case float32:
		parsed = float64(item)
	case float64:
		parsed = item
	case string:
		next, err := strconv.ParseFloat(strings.TrimSpace(item), 64)
		if err != nil {
			return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		parsed = next
	default:
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if parsed < 0 {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	return parsed, nil
}

func decodeMusicIterationBase64(value string) ([]byte, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if decoded, err := base64.StdEncoding.DecodeString(trimmed); err == nil && len(decoded) > 0 {
		return decoded, nil
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(trimmed); err == nil && len(decoded) > 0 {
		return decoded, nil
	}
	return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
}
