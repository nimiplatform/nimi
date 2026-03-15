package ai

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) validateCatalogAwareScenarioSupport(
	ctx context.Context,
	scenarioType runtimev1.ScenarioType,
	providerType string,
	modelResolved string,
	spec *runtimev1.ScenarioSpec,
) error {
	if s == nil || s.speechCatalog == nil || spec == nil {
		return nil
	}
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return s.validateVideoGenerateAgainstCatalog(ctx, providerType, modelResolved, spec.GetVideoGenerate())
	default:
		return nil
	}
}

func (s *Service) validateVideoGenerateAgainstCatalog(
	ctx context.Context,
	providerType string,
	modelResolved string,
	spec *runtimev1.VideoGenerateScenarioSpec,
) error {
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}

	model, err := s.speechCatalog.ResolveModelEntryForSubject(catalogSubjectUserIDFromContext(ctx), providerType, modelResolved)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
		}
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if model.VideoGeneration == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	modeToken := videoModeCatalogToken(spec.GetMode())
	if modeToken == "" || !videoGenerationSupportsMode(model.VideoGeneration, modeToken) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	actualRoles := videoScenarioInputRoles(spec)
	if !sameStringSet(actualRoles, model.VideoGeneration.InputRoles[modeToken]) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	options := spec.GetOptions()
	if options == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}

	if value := strings.TrimSpace(options.GetResolution()); value != "" {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "resolution"); err != nil {
			return err
		}
		if err := ensureStringLimitContains(model.VideoGeneration.Limits["resolution"], value); err != nil {
			return err
		}
	}
	if value := strings.TrimSpace(options.GetRatio()); value != "" {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "ratio"); err != nil {
			return err
		}
		if err := ensureStringLimitContains(model.VideoGeneration.Limits["ratio"], value); err != nil {
			return err
		}
	}
	if value := options.GetDurationSec(); value > 0 {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "duration_sec"); err != nil {
			return err
		}
		if err := ensureNumericRange(model.VideoGeneration.Limits["duration_sec"], int64(value)); err != nil {
			return err
		}
	}
	if value := options.GetFrames(); value > 0 {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "frames"); err != nil {
			return err
		}
		if limit := model.VideoGeneration.Limits["frames"]; limit != nil {
			if err := ensureNumericRange(limit, int64(value)); err != nil {
				return err
			}
		}
	}
	if value := options.GetFps(); value > 0 {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "fps"); err != nil {
			return err
		}
		if limit := model.VideoGeneration.Limits["fps"]; limit != nil {
			if err := ensureNumericRange(limit, int64(value)); err != nil {
				return err
			}
		}
	}
	if value := options.GetSeed(); value != 0 {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "seed"); err != nil {
			return err
		}
		if limit := model.VideoGeneration.Limits["seed"]; limit != nil {
			if err := ensureNumericRange(limit, int64(value)); err != nil {
				return err
			}
		}
	}
	if options.GetCameraFixed() {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "camera_fixed"); err != nil {
			return err
		}
	}
	if options.GetWatermark() {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "watermark"); err != nil {
			return err
		}
	}
	if options.GetGenerateAudio() {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "generate_audio"); err != nil {
			return err
		}
	}
	if options.GetDraft() {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "draft"); err != nil {
			return err
		}
	}
	if value := strings.TrimSpace(options.GetServiceTier()); value != "" {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "service_tier"); err != nil {
			return err
		}
	}
	if value := options.GetExecutionExpiresAfterSec(); value > 0 {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "execution_expires_after_sec"); err != nil {
			return err
		}
	}
	if options.GetReturnLastFrame() {
		if err := ensureVideoOptionSupported(model.VideoGeneration, "return_last_frame"); err != nil {
			return err
		}
		if !model.VideoGeneration.Outputs.LastFrameURL {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}

	if modeToken == "i2v_reference" {
		referenceCount := videoReferenceImageCount(spec)
		if limit := model.VideoGeneration.Limits["reference_images"]; limit != nil {
			if err := ensureNumericRange(limit, int64(referenceCount)); err != nil {
				return err
			}
		}
	}

	return nil
}

func videoModeCatalogToken(mode runtimev1.VideoMode) string {
	switch mode {
	case runtimev1.VideoMode_VIDEO_MODE_T2V:
		return "t2v"
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		return "i2v_first_frame"
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
		return "i2v_first_last"
	case runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE:
		return "i2v_reference"
	default:
		return ""
	}
}

func videoGenerationSupportsMode(capability *catalog.VideoGenerationCapability, mode string) bool {
	if capability == nil {
		return false
	}
	for _, candidate := range capability.Modes {
		if strings.EqualFold(strings.TrimSpace(candidate), mode) {
			return true
		}
	}
	return false
}

func videoScenarioInputRoles(spec *runtimev1.VideoGenerateScenarioSpec) []string {
	if spec == nil {
		return nil
	}
	roles := map[string]struct{}{}
	for _, item := range spec.GetContent() {
		if item == nil {
			continue
		}
		switch item.GetType() {
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT:
			roles["prompt"] = struct{}{}
		case runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL:
			switch item.GetRole() {
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
				roles["first_frame"] = struct{}{}
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
				roles["last_frame"] = struct{}{}
			case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE:
				roles["reference_image"] = struct{}{}
			}
		}
	}
	out := make([]string, 0, len(roles))
	for role := range roles {
		out = append(out, role)
	}
	sort.Strings(out)
	return out
}

func videoReferenceImageCount(spec *runtimev1.VideoGenerateScenarioSpec) int {
	count := 0
	if spec == nil {
		return count
	}
	for _, item := range spec.GetContent() {
		if item == nil {
			continue
		}
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL &&
			item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE {
			count++
		}
	}
	return count
}

func sameStringSet(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	if len(left) == 0 {
		return true
	}
	lset := make(map[string]struct{}, len(left))
	for _, item := range left {
		lset[strings.ToLower(strings.TrimSpace(item))] = struct{}{}
	}
	for _, item := range right {
		if _, ok := lset[strings.ToLower(strings.TrimSpace(item))]; !ok {
			return false
		}
	}
	return true
}

func ensureVideoOptionSupported(capability *catalog.VideoGenerationCapability, option string) error {
	if capability == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	normalized := strings.ToLower(strings.TrimSpace(option))
	for _, candidate := range capability.Options.Supports {
		if strings.ToLower(strings.TrimSpace(candidate)) == normalized {
			return nil
		}
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
}

func ensureStringLimitContains(limit any, value string) error {
	if limit == nil {
		return nil
	}
	normalizedValue := strings.ToLower(strings.TrimSpace(value))
	switch typed := limit.(type) {
	case []any:
		for _, item := range typed {
			if strings.ToLower(strings.TrimSpace(anyToString(item))) == normalizedValue {
				return nil
			}
		}
	case []string:
		for _, item := range typed {
			if strings.ToLower(strings.TrimSpace(item)) == normalizedValue {
				return nil
			}
		}
	default:
		return nil
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
}

func ensureNumericRange(limit any, value int64) error {
	limits, ok := limit.(map[string]any)
	if !ok || len(limits) == 0 {
		return nil
	}
	if rawMin, ok := limits["min"]; ok {
		if min, ok := anyToInt64(rawMin); ok && value < min {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}
	if rawMax, ok := limits["max"]; ok {
		if max, ok := anyToInt64(rawMax); ok && value > max {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}
	return nil
}

func anyToString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(value)
	}
}

func anyToInt64(value any) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int32:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		return int64(typed), true
	case uint32:
		return int64(typed), true
	case uint64:
		return int64(typed), true
	default:
		return 0, false
	}
}
