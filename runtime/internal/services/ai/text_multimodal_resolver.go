package ai

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type textGenerateResolution struct {
	spec    *runtimev1.TextGenerateScenarioSpec
	cleanup func()
}

func (r textGenerateResolution) release() {
	if r.cleanup != nil {
		r.cleanup()
	}
}

func (s *Service) resolveTextGenerateScenario(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	spec *runtimev1.TextGenerateScenarioSpec,
) (textGenerateResolution, error) {
	if spec == nil {
		return textGenerateResolution{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	cloned, ok := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	if !ok || cloned == nil {
		return textGenerateResolution{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}

	cleanupFns := make([]func(), 0, 2)
	release := func() {
		for i := len(cleanupFns) - 1; i >= 0; i-- {
			cleanupFns[i]()
		}
	}

	for _, message := range cloned.GetInput() {
		if message == nil || len(message.GetParts()) == 0 {
			continue
		}
		resolvedParts := make([]*runtimev1.ChatContentPart, 0, len(message.GetParts()))
		for _, part := range message.GetParts() {
			if part == nil {
				continue
			}
			if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
				resolvedParts = append(resolvedParts, part)
				continue
			}
			resolvedPart, cleanup, err := s.resolveTextGenerateArtifactPart(ctx, head, modelResolved, remoteTarget, selected, part.GetArtifactRef())
			if err != nil {
				release()
				return textGenerateResolution{}, err
			}
			if cleanup != nil {
				cleanupFns = append(cleanupFns, cleanup)
			}
			resolvedParts = append(resolvedParts, resolvedPart)
		}
		message.Parts = resolvedParts
	}

	if err := validateResolvedTextGenerateInput(cloned.GetSystemPrompt(), cloned.GetInput()); err != nil {
		release()
		return textGenerateResolution{}, err
	}

	return textGenerateResolution{
		spec:    cloned,
		cleanup: release,
	}, nil
}

func validateResolvedTextGenerateInput(systemPrompt string, input []*runtimev1.ChatMessage) error {
	if strings.TrimSpace(systemPrompt) == "" && len(input) == 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	for _, message := range input {
		if message == nil || strings.EqualFold(strings.TrimSpace(message.GetRole()), "system") {
			continue
		}
		if chatMessageHasRenderableContent(message) {
			return nil
		}
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
}

func chatMessageHasRenderableContent(message *runtimev1.ChatMessage) bool {
	if message == nil {
		return false
	}
	if strings.TrimSpace(message.GetContent()) != "" {
		return true
	}
	for _, part := range message.GetParts() {
		if part == nil {
			continue
		}
		switch part.GetType() {
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
			if strings.TrimSpace(part.GetText()) != "" {
				return true
			}
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
			if strings.TrimSpace(part.GetImageUrl().GetUrl()) != "" {
				return true
			}
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
			if strings.TrimSpace(part.GetVideoUrl()) != "" {
				return true
			}
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
			if strings.TrimSpace(part.GetAudioUrl()) != "" {
				return true
			}
		}
	}
	return false
}

func (s *Service) resolveTextGenerateArtifactPart(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	ref *runtimev1.ChatContentArtifactRef,
) (*runtimev1.ChatContentPart, func(), error) {
	if ref == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	resolvedPath, mimeType, cleanup, err := s.resolveTextGenerateArtifactPath(ctx, head, modelResolved, remoteTarget, selected, ref)
	if err != nil {
		return nil, nil, err
	}
	partType, err := classifyTextGenerateArtifactMedia(ref.GetMimeType(), mimeType, resolvedPath)
	if err != nil {
		if cleanup != nil {
			cleanup()
		}
		return nil, nil, err
	}

	switch partType {
	case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
		return &runtimev1.ChatContentPart{
			Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL,
			ImageUrl: &runtimev1.ChatContentImageURL{
				Url:    resolvedPath,
				Detail: "auto",
			},
		}, cleanup, nil
	case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
		return &runtimev1.ChatContentPart{
			Type:     runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL,
			VideoUrl: resolvedPath,
		}, cleanup, nil
	case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
		return &runtimev1.ChatContentPart{
			Type:     runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL,
			AudioUrl: resolvedPath,
		}, cleanup, nil
	default:
		if cleanup != nil {
			cleanup()
		}
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
}

func (s *Service) resolveTextGenerateArtifactPath(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	ref *runtimev1.ChatContentArtifactRef,
) (string, string, func(), error) {
	if ref == nil {
		return "", "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	if artifactID := strings.TrimSpace(ref.GetArtifactId()); artifactID != "" {
		artifact, _, ok := s.scenarioJobs.findArtifact(head.GetAppId(), head.GetSubjectUserId(), artifactID)
		if !ok || artifact == nil {
			return "", "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if uri := strings.TrimSpace(artifact.GetUri()); uri != "" {
			if strings.HasPrefix(strings.ToLower(uri), "data:") {
				return "", "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
			}
			return uri, firstNonEmpty(strings.TrimSpace(ref.GetMimeType()), strings.TrimSpace(artifact.GetMimeType())), nil, nil
		}
		if len(artifact.GetBytes()) == 0 {
			return "", "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		path, cleanup, err := writeTextGenerateArtifactTempFile(firstNonEmpty(ref.GetMimeType(), artifact.GetMimeType()), artifact.GetBytes())
		if err != nil {
			return "", "", nil, err
		}
		return path, firstNonEmpty(strings.TrimSpace(ref.GetMimeType()), strings.TrimSpace(artifact.GetMimeType())), cleanup, nil
	}

	localArtifactID := strings.TrimSpace(ref.GetLocalArtifactId())
	if localArtifactID == "" {
		return "", "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if !isLocalAITextGenerateRoute(modelResolved, remoteTarget, selected) {
		return "", "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if s == nil || s.localImageProfile == nil {
		return "", "", nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	path, err := s.localImageProfile.ResolveLocalAIArtifactPath(ctx, localArtifactID)
	if err != nil {
		return "", "", nil, err
	}
	return path, strings.TrimSpace(ref.GetMimeType()), nil, nil
}

func isLocalAITextGenerateRoute(modelResolved string, remoteTarget *nimillm.RemoteTarget, selected provider) bool {
	return inferScenarioProviderType(modelResolved, remoteTarget, selected, runtimev1.Modal_MODAL_UNSPECIFIED) == "localai"
}

func classifyTextGenerateArtifactMedia(explicitMime string, resolvedMime string, resolvedPath string) (runtimev1.ChatContentPartType, error) {
	mimeType := firstNonEmpty(strings.TrimSpace(explicitMime), strings.TrimSpace(resolvedMime), inferMimeTypeFromLocation(resolvedPath))
	lower := strings.ToLower(strings.TrimSpace(mimeType))
	switch {
	case strings.HasPrefix(lower, "image/"):
		return runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, nil
	case strings.HasPrefix(lower, "video/"):
		return runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL, nil
	case strings.HasPrefix(lower, "audio/"):
		return runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL, nil
	default:
		return runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_UNSPECIFIED, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
}

func inferMimeTypeFromLocation(location string) string {
	value := strings.TrimSpace(location)
	if value == "" {
		return ""
	}
	if parsed, err := url.Parse(value); err == nil {
		if parsed.Scheme != "" && parsed.Scheme != "file" {
			value = parsed.Path
		}
		if parsed.Scheme == "file" {
			value = parsed.Path
		}
	}
	switch strings.ToLower(filepath.Ext(value)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".bmp":
		return "image/bmp"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".mkv":
		return "video/x-matroska"
	case ".avi":
		return "video/x-msvideo"
	case ".webm":
		return "video/webm"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	case ".aac":
		return "audio/aac"
	case ".flac":
		return "audio/flac"
	case ".ogg", ".oga":
		return "audio/ogg"
	case ".opus":
		return "audio/opus"
	default:
		return ""
	}
}

func writeTextGenerateArtifactTempFile(mimeType string, payload []byte) (string, func(), error) {
	ext := extensionForMimeType(mimeType)
	file, err := os.CreateTemp("", "nimi-text-multimodal-*"+ext)
	if err != nil {
		return "", nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if _, err := file.Write(payload); err != nil {
		file.Close()
		_ = os.Remove(file.Name())
		return "", nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(file.Name())
		return "", nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	return file.Name(), func() {
		_ = os.Remove(file.Name())
	}, nil
}

func extensionForMimeType(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/bmp":
		return ".bmp"
	case "video/mp4":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	case "video/webm":
		return ".webm"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav":
		return ".wav"
	case "audio/mp4":
		return ".m4a"
	case "audio/flac":
		return ".flac"
	case "audio/ogg":
		return ".ogg"
	case "audio/opus":
		return ".opus"
	default:
		return ""
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func describeTextGenerateArtifactRef(ref *runtimev1.ChatContentArtifactRef) string {
	if ref == nil {
		return "artifact_ref"
	}
	if value := strings.TrimSpace(ref.GetArtifactId()); value != "" {
		return fmt.Sprintf("artifact_id=%s", value)
	}
	if value := strings.TrimSpace(ref.GetLocalArtifactId()); value != "" {
		return fmt.Sprintf("local_artifact_id=%s", value)
	}
	return "artifact_ref"
}
