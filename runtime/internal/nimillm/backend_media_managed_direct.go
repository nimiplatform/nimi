package nimillm

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
)

func (b *Backend) GenerateImageManagedMediaDirect(
	ctx context.Context,
	modelsRoot string,
	backendAddress string,
	profile map[string]any,
	spec *runtimev1.ImageGenerateScenarioSpec,
	scenarioExtensions map[string]any,
	onProgress func(ManagedMediaImageProgress),
) ([]byte, *runtimev1.UsageStats, *ManagedMediaImageDiagnostics, error) {
	if spec == nil {
		return nil, nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	prompt := strings.TrimSpace(spec.GetPrompt())
	if prompt == "" {
		return nil, nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if strings.TrimSpace(modelsRoot) == "" || strings.TrimSpace(backendAddress) == "" {
		return nil, nil, nil, grpcerr.WithReasonCodeOptions(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
			grpcerr.ReasonOptions{Message: "managed image backend target is unavailable"},
		)
	}

	if _, err := normalizeImageResponseFormat(spec.GetResponseFormat()); err != nil {
		return nil, nil, nil, err
	}

	backendName := strings.ToLower(strings.TrimSpace(ValueAsString(profile["backend"])))
	if backendName != "" && backendName != "stablediffusion-ggml" {
		return nil, nil, nil, grpcerr.WithReasonCodeOptions(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
			grpcerr.ReasonOptions{Message: "managed image backend must be stablediffusion-ggml"},
		)
	}

	modelPath := strings.TrimSpace(ValueAsString(MapField(profile["parameters"], "model")))
	if modelPath == "" {
		return nil, nil, nil, grpcerr.WithReasonCodeOptions(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
			grpcerr.ReasonOptions{Message: "managed image profile is missing parameters.model"},
		)
	}
	modelPath = resolveManagedMediaModelPath(modelsRoot, modelPath)
	width, height, err := parseManagedMediaImageSize(spec.GetSize())
	if err != nil {
		return nil, nil, nil, err
	}

	tempDir, err := os.MkdirTemp("", "nimi-managed-image-*")
	if err != nil {
		return nil, nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	defer os.RemoveAll(tempDir)

	resolvedRefImages, err := b.materializeManagedMediaImages(ctx, spec.GetReferenceImages(), tempDir, "reference")
	if err != nil {
		return nil, nil, nil, err
	}
	maskPath := ""
	if strings.TrimSpace(spec.GetMask()) != "" {
		maskPath, err = b.materializeManagedMediaImage(ctx, spec.GetMask(), tempDir, "mask")
		if err != nil {
			return nil, nil, nil, err
		}
	}
	enableParams := ""
	if maskPath != "" {
		enableParams = "mask:" + maskPath
	}

	sourceImage := ""
	sourcePath := ""
	refImages := []string{}
	if len(resolvedRefImages) > 0 {
		sourceImage = strings.TrimSpace(spec.GetReferenceImages()[0])
		sourcePath = resolvedRefImages[0]
		if len(resolvedRefImages) > 1 {
			refImages = append(refImages, resolvedRefImages[1:]...)
		}
	}

	negativePrompt := strings.TrimSpace(spec.GetNegativePrompt())
	localPrompt := prompt
	if negativePrompt != "" && !strings.Contains(localPrompt, "|") {
		localPrompt = strings.TrimSpace(localPrompt + "|" + negativePrompt)
	}
	appliedOptions := managedMediaAppliedOptions(profile, scenarioExtensions)
	ignoredOptions := managedMediaIgnoredOptions(scenarioExtensions)
	step := managedMediaResolveStep(profile, scenarioExtensions)

	destinationPath := filepath.Join(tempDir, "artifact.png")
	startedAt := time.Now()
	slog.Info("managed image generate start",
		"backend_address", strings.TrimSpace(backendAddress),
		"model_path", modelPath,
		"width", width,
		"height", height,
		"step", step,
		"cfg_scale", managedMediaResolveCFGScale(profile, scenarioExtensions),
		"seed", managedMediaClampInt32(spec.GetSeed()),
		"has_source_image", sourcePath != "",
		"ref_images_count", len(refImages),
		"has_mask", maskPath != "",
	)
	err = managedimagebackend.GenerateImage(ctx, managedimagebackend.ImageRequest{
		BackendAddress: backendAddress,
		ModelsRoot:     modelsRoot,
		ModelPath:      modelPath,
		Options:        managedMediaStringSlice(profile["options"]),
		CFGScale:       managedMediaResolveCFGScale(profile, scenarioExtensions),
		Width:          width,
		Height:         height,
		Step:           step,
		Seed:           managedMediaClampInt32(spec.GetSeed()),
		PositivePrompt: prompt,
		NegativePrompt: negativePrompt,
		Dst:            destinationPath,
		Src:            sourcePath,
		EnableParams:   enableParams,
		RefImages:      refImages,
		OnProgress: func(progress managedimagebackend.ImageGenerateProgress) {
			if onProgress == nil {
				return
			}
			onProgress(ManagedMediaImageProgress{
				CurrentStep:     progress.CurrentStep,
				TotalSteps:      progress.TotalSteps,
				ProgressPercent: progress.ProgressPercent,
			})
		},
	})
	generateDurationMs := time.Since(startedAt).Milliseconds()
	if err != nil {
		slog.Warn("managed image generate failed",
			"backend_address", strings.TrimSpace(backendAddress),
			"model_path", modelPath,
			"width", width,
			"height", height,
			"step", step,
			"duration_ms", generateDurationMs,
			"error", err,
		)
		switch status.Code(err) {
		case codes.DeadlineExceeded, codes.Unavailable:
			return nil, nil, nil, MapProviderRequestError(err)
		}
		providerMessage := strings.TrimSpace(err.Error())
		return nil, nil, nil, grpcerr.WithReasonCodeOptions(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			grpcerr.ReasonOptions{
				Message: providerMessage,
				Metadata: map[string]string{
					"provider_message": providerMessage,
				},
			},
		)
	}
	slog.Info("managed image generate completed",
		"backend_address", strings.TrimSpace(backendAddress),
		"model_path", modelPath,
		"width", width,
		"height", height,
		"step", step,
		"duration_ms", generateDurationMs,
	)

	payload, err := os.ReadFile(destinationPath)
	if err != nil || len(payload) == 0 {
		return nil, nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	diag := &ManagedMediaImageDiagnostics{
		LocalPrompt:    localPrompt,
		SourceImage:    sourceImage,
		RefImagesCount: managedMediaRefImagesCount(resolvedRefImages),
		AppliedOptions: appliedOptions,
		IgnoredOptions: ignoredOptions,
	}
	usage := ArtifactUsage(localPrompt, payload, 180)
	return payload, usage, diag, nil
}

func parseManagedMediaImageSize(raw string) (int32, int32, error) {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return 1024, 1024, nil
	}
	parts := strings.SplitN(trimmed, "x", 2)
	if len(parts) != 2 {
		return 1024, 1024, nil
	}
	width := ValueAsInt32(parts[0])
	height := ValueAsInt32(parts[1])
	if width <= 0 || height <= 0 {
		return 0, 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return width, height, nil
}

func resolveManagedMediaModelPath(modelsRoot string, modelPath string) string {
	trimmed := strings.TrimSpace(modelPath)
	if trimmed == "" || filepath.IsAbs(trimmed) {
		return trimmed
	}
	if strings.TrimSpace(modelsRoot) == "" {
		return trimmed
	}
	return filepath.Join(strings.TrimSpace(modelsRoot), filepath.FromSlash(trimmed))
}

func managedMediaStringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if trimmed := strings.TrimSpace(item); trimmed != "" {
				out = append(out, trimmed)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if trimmed := strings.TrimSpace(ValueAsString(item)); trimmed != "" {
				out = append(out, trimmed)
			}
		}
		return out
	default:
		return nil
	}
}

func managedMediaResolveStep(profile map[string]any, scenarioExtensions map[string]any) int32 {
	if step := ValueAsInt32(scenarioExtensions["step"]); step > 0 {
		return step
	}
	if steps := ValueAsInt32(scenarioExtensions["steps"]); steps > 0 {
		return steps
	}
	if step := ValueAsInt32(profile["step"]); step > 0 {
		return step
	}
	if steps := ValueAsInt32(profile["steps"]); steps > 0 {
		return steps
	}
	return 4
}

func managedMediaResolveCFGScale(profile map[string]any, scenarioExtensions map[string]any) float32 {
	for _, value := range []any{
		scenarioExtensions["cfg_scale"],
		scenarioExtensions["cfgScale"],
		profile["cfg_scale"],
		profile["cfgScale"],
		MapField(profile["parameters"], "cfg_scale"),
		MapField(profile["parameters"], "cfgScale"),
	} {
		switch typed := value.(type) {
		case float32:
			if typed > 0 {
				return typed
			}
		case float64:
			if typed > 0 {
				return float32(typed)
			}
		case int:
			if typed > 0 {
				return float32(typed)
			}
		case int32:
			if typed > 0 {
				return float32(typed)
			}
		case int64:
			if typed > 0 {
				return float32(typed)
			}
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed == "" {
				continue
			}
			if parsed, err := strconv.ParseFloat(trimmed, 32); err == nil && parsed > 0 {
				return float32(parsed)
			}
		}
	}
	return 0
}

type managedMediaLoadOverrides struct {
	CFGScale  float32
	Sampler   string
	Scheduler string
}

func managedMediaClampInt32(value int64) int32 {
	if value > maxInt32Value {
		return int32(maxInt32Value)
	}
	if value < minInt32Value {
		return int32(minInt32Value)
	}
	return int32(value)
}

func managedMediaResolveSampler(profile map[string]any, scenarioExtensions map[string]any) string {
	for _, value := range []any{
		scenarioExtensions["mode"],
		scenarioExtensions["method"],
		profile["mode"],
		profile["sampling_method"],
	} {
		if sampler := managedMediaCanonicalSampler(ValueAsString(value)); sampler != "" {
			return sampler
		}
	}
	return "euler"
}

func managedMediaResolveLoadOverrides(profile map[string]any, scenarioExtensions map[string]any) managedMediaLoadOverrides {
	return managedMediaLoadOverrides{
		CFGScale:  managedMediaResolveCFGScale(profile, scenarioExtensions),
		Sampler:   managedMediaResolveSampler(profile, scenarioExtensions),
		Scheduler: managedMediaResolveScheduler(profile, scenarioExtensions),
	}
}

func managedMediaResolveScheduler(profile map[string]any, scenarioExtensions map[string]any) string {
	for _, value := range []any{
		scenarioExtensions["scheduler"],
		profile["scheduler"],
		MapField(profile["parameters"], "scheduler"),
	} {
		if scheduler := managedMediaCanonicalScheduler(ValueAsString(value)); scheduler != "" {
			return scheduler
		}
	}
	return "discrete"
}

func managedMediaCanonicalScheduler(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "default", "discrete":
		return "discrete"
	case "karras":
		return "karras"
	case "exponential":
		return "exponential"
	case "ays":
		return "ays"
	case "gits":
		return "gits"
	case "smoothstep":
		return "smoothstep"
	case "sgm_uniform":
		return "sgm_uniform"
	case "simple":
		return "simple"
	case "kl_optimal":
		return "kl_optimal"
	case "lcm":
		return "lcm"
	case "bong_tangent":
		return "bong_tangent"
	default:
		return ""
	}
}

func managedMediaCanonicalSampler(method string) string {
	switch strings.ToLower(strings.TrimSpace(method)) {
	case "euler_a":
		return "euler_a"
	case "euler":
		return "euler"
	case "heun":
		return "heun"
	case "dpm2":
		return "dpm2"
	case "dpmpp2s_a", "dpm++2s_a":
		return "dpmpp2s_a"
	case "dpmpp2m", "dpm++2m":
		return "dpmpp2m"
	case "dpmpp2mv2", "dpm++2mv2":
		return "dpmpp2mv2"
	case "ipndm":
		return "ipndm"
	case "ipndm_v":
		return "ipndm_v"
	case "lcm":
		return "lcm"
	default:
		return ""
	}
}

func managedMediaAppliedOptions(profile map[string]any, scenarioExtensions map[string]any) []string {
	loadOverrides := managedMediaResolveLoadOverrides(profile, scenarioExtensions)
	applied := make([]string, 0, 6)
	if step := ValueAsInt32(scenarioExtensions["step"]); step > 0 {
		applied = append(applied, "step")
	} else if steps := ValueAsInt32(scenarioExtensions["steps"]); steps > 0 {
		applied = append(applied, "steps->step")
	} else if step := ValueAsInt32(profile["step"]); step > 0 {
		applied = append(applied, "profile.step")
	} else if steps := ValueAsInt32(profile["steps"]); steps > 0 {
		applied = append(applied, "profile.steps->step")
	}
	if loadOverrides.Sampler != "" {
		if mode := strings.TrimSpace(ValueAsString(scenarioExtensions["mode"])); mode != "" {
			applied = append(applied, "mode")
		} else if method := strings.TrimSpace(ValueAsString(scenarioExtensions["method"])); method != "" {
			applied = append(applied, "method->mode")
		} else if mode := strings.TrimSpace(ValueAsString(profile["mode"])); mode != "" {
			applied = append(applied, "profile.mode")
		} else if method := strings.TrimSpace(ValueAsString(profile["sampling_method"])); method != "" {
			applied = append(applied, "profile.sampling_method->mode")
		}
	}
	if loadOverrides.Scheduler != "" {
		if scheduler := strings.TrimSpace(ValueAsString(scenarioExtensions["scheduler"])); scheduler != "" {
			applied = append(applied, "scheduler")
		} else if scheduler := strings.TrimSpace(ValueAsString(profile["scheduler"])); scheduler != "" {
			applied = append(applied, "profile.scheduler")
		} else {
			applied = append(applied, "default.scheduler")
		}
	}
	if cfgScale := loadOverrides.CFGScale; cfgScale > 0 {
		if _, ok := scenarioExtensions["cfg_scale"]; ok {
			applied = append(applied, "cfg_scale")
		} else if _, ok := scenarioExtensions["cfgScale"]; ok {
			applied = append(applied, "cfgScale->cfg_scale")
		}
	}
	return applied
}

func managedMediaIgnoredOptions(scenarioExtensions map[string]any) []string {
	ignored := make([]string, 0, 5)
	for _, key := range []string{"guidance_scale", "eta", "strength", "clip_skip"} {
		if _, exists := scenarioExtensions[key]; exists {
			ignored = append(ignored, key)
		}
	}
	return ignored
}

func (b *Backend) materializeManagedMediaImages(ctx context.Context, sources []string, tempDir string, prefix string) ([]string, error) {
	if len(sources) == 0 {
		return nil, nil
	}
	paths := make([]string, 0, len(sources))
	for index, source := range sources {
		path, err := b.materializeManagedMediaImage(ctx, source, tempDir, fmt.Sprintf("%s-%d", prefix, index))
		if err != nil {
			return nil, err
		}
		paths = append(paths, path)
	}
	return paths, nil
}

func (b *Backend) materializeManagedMediaImage(ctx context.Context, source string, tempDir string, prefix string) (string, error) {
	trimmed := strings.TrimSpace(source)
	if trimmed == "" {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "data:") {
		payload, mimeType, err := decodeInlineDataURL(trimmed)
		if err != nil {
			return "", err
		}
		return writeManagedMediaTempFile(tempDir, prefix, extensionForManagedMedia(mimeType, trimmed), payload)
	}
	if strings.HasPrefix(lower, "file://") {
		parsed, err := url.Parse(trimmed)
		if err != nil || strings.TrimSpace(parsed.Path) == "" {
			return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		return parsed.Path, nil
	}
	if isRemoteHTTPURL(trimmed) {
		if err := endpointsec.ValidateEndpoint(ctx, trimmed, b != nil && b.allowLoopbackEndpoint); err != nil {
			return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, trimmed, nil)
		if err != nil {
			return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		response, err := b.do(request)
		if err != nil {
			return "", MapProviderRequestError(err)
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return "", MapProviderHTTPError(response.StatusCode, nil)
		}
		payload, err := io.ReadAll(io.LimitReader(response.Body, maxInlineOpenAIMediaBytes+1))
		if err != nil {
			return "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		if len(payload) == 0 || len(payload) > maxInlineOpenAIMediaBytes {
			return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		return writeManagedMediaTempFile(tempDir, prefix, extensionForManagedMedia(response.Header.Get("Content-Type"), trimmed), payload)
	}
	return trimmed, nil
}

func extensionForManagedMedia(mimeType string, source string) string {
	if extension := strings.TrimSpace(filepath.Ext(strings.TrimSpace(source))); extension != "" && extension != "." {
		return extension
	}
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	}
	if byType, _ := mime.ExtensionsByType(strings.TrimSpace(mimeType)); len(byType) > 0 {
		return byType[0]
	}
	return ".bin"
}

func writeManagedMediaTempFile(tempDir string, prefix string, extension string, payload []byte) (string, error) {
	target := filepath.Join(tempDir, prefix+extension)
	if err := os.WriteFile(target, payload, 0o600); err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	return target, nil
}

func managedMediaRefImagesCount(paths []string) int {
	if len(paths) <= 1 {
		return 0
	}
	return len(paths) - 1
}
