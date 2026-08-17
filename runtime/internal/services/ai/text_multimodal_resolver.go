package ai

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
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
	_ string,
	_ *nimillm.RemoteTarget,
	_ provider,
	spec *runtimev1.TextGenerateScenarioSpec,
) (textGenerateResolution, error) {
	return s.resolveTextGenerateScenarioForRoute(
		ctx,
		head,
		spec,
		false,
	)
}

func (s *Service) resolveSelectedLocalTextGenerateScenario(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	spec *runtimev1.TextGenerateScenarioSpec,
) (textGenerateResolution, error) {
	return s.resolveTextGenerateScenarioForRoute(ctx, head, spec, true)
}

func (s *Service) resolveTextGenerateScenarioForRoute(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	spec *runtimev1.TextGenerateScenarioSpec,
	localText bool,
) (textGenerateResolution, error) {
	if spec == nil {
		return textGenerateResolution{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	cloned, ok := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	if !ok || cloned == nil {
		return textGenerateResolution{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	normalizeClonedReasoningConfig(cloned)

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
			resolvedPart, cleanup, err := s.resolveTextGenerateArtifactPart(ctx, head, localText, part.GetArtifactRef())
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
	localText bool,
	ref *runtimev1.ChatContentArtifactRef,
) (*runtimev1.ChatContentPart, func(), error) {
	if ref == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	resolvedPath, mimeType, cleanup, err := s.resolveTextGenerateArtifactPath(ctx, head, localText, ref)
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
		imageURL := resolvedPath
		if !localText {
			inlineURL, err := inlineRemoteTextGenerateImageURL(resolvedPath, mimeType)
			if err != nil {
				if cleanup != nil {
					cleanup()
				}
				return nil, nil, err
			}
			imageURL = inlineURL
		}
		return &runtimev1.ChatContentPart{
			Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL,
			Content: &runtimev1.ChatContentPart_ImageUrl{
				ImageUrl: &runtimev1.ChatContentImageURL{
					Url:    imageURL,
					Detail: "auto",
				},
			},
		}, cleanup, nil
	case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
		return &runtimev1.ChatContentPart{
			Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL,
			Content: &runtimev1.ChatContentPart_VideoUrl{
				VideoUrl: resolvedPath,
			},
		}, cleanup, nil
	case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
		return &runtimev1.ChatContentPart{
			Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL,
			Content: &runtimev1.ChatContentPart_AudioUrl{
				AudioUrl: resolvedPath,
			},
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
	localText bool,
	ref *runtimev1.ChatContentArtifactRef,
) (string, string, func(), error) {
	if ref == nil {
		return "", "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	if artifactID := strings.TrimSpace(ref.GetArtifactId()); artifactID != "" {
		if decision, localApp := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); localApp {
			source, err := s.openAuthorizedLocalAppArtifact(ctx, decision, artifactID, localAppArtifactOperationInput)
			if err != nil {
				return "", "", nil, err
			}
			defer func() { _ = source.Body.Close() }()
			mimeType := firstNonEmpty(strings.TrimSpace(source.Record.MimeType), strings.TrimSpace(ref.GetMimeType()))
			path, cleanup, writeErr := writeTextGenerateArtifactTempStream(ctx, mimeType, source.Body, source.Record.SizeBytes)
			if writeErr != nil {
				return "", "", nil, writeErr
			}
			return path, mimeType, cleanup, nil
		}
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
	if decision, localApp := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); localApp {
		source, err := s.openAuthorizedLocalAppArtifact(ctx, decision, localArtifactID, localAppArtifactOperationInput)
		if err != nil {
			return "", "", nil, err
		}
		defer func() { _ = source.Body.Close() }()
		mimeType := firstNonEmpty(strings.TrimSpace(source.Record.MimeType), strings.TrimSpace(ref.GetMimeType()))
		path, cleanup, writeErr := writeTextGenerateArtifactTempStream(ctx, mimeType, source.Body, source.Record.SizeBytes)
		if writeErr != nil {
			return "", "", nil, writeErr
		}
		return path, mimeType, cleanup, nil
	}
	// User attachment plane (rule.nimi.runtime.agent-participation.r171):
	// owner-carrying upload records resolve from the runtime artifact store,
	// and only when the request head identity equals the upload-time owner.
	// The artifact id alone never authorizes resolution; ownerless records
	// keep the existing managed-asset behavior below.
	if s != nil && s.runtimeArtifacts != nil {
		if record, ok := s.runtimeArtifacts.Get(localArtifactID); ok && record.Owner != nil {
			if record.Owner.SubjectUserID != strings.TrimSpace(head.GetSubjectUserId()) ||
				record.Owner.AppID != strings.TrimSpace(head.GetAppId()) ||
				len(record.Bytes) == 0 {
				return "", "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			mimeType := firstNonEmpty(strings.TrimSpace(record.MimeType), strings.TrimSpace(ref.GetMimeType()))
			path, cleanup, err := writeTextGenerateArtifactTempFile(mimeType, record.Bytes)
			if err != nil {
				return "", "", nil, err
			}
			return path, mimeType, cleanup, nil
		}
	}
	// Owner-carrying Runtime artifacts and authorized Local App artifacts are
	// the complete supported local input planes. A legacy LocalAsset id is not
	// an attachment capability and must never resolve by possession alone.
	return "", "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
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
		return "", nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "failed to create temporary artifact file",
		})
	}
	if _, err := file.Write(payload); err != nil {
		_ = file.Close()
		_ = os.Remove(file.Name())
		return "", nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "failed to write temporary artifact file",
		})
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(file.Name())
		return "", nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "failed to close temporary artifact file",
		})
	}
	return file.Name(), func() {
		_ = os.Remove(file.Name())
	}, nil
}

func writeTextGenerateArtifactTempStream(ctx context.Context, mimeType string, source io.Reader, expectedSize int64) (string, func(), error) {
	if ctx == nil || source == nil || expectedSize <= 0 || expectedSize > runtimeartifact.MaxCustodyBytes {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	ext := extensionForMimeType(mimeType)
	file, err := os.CreateTemp("", "nimi-text-multimodal-*"+ext)
	if err != nil {
		return "", nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "failed to create temporary artifact file"})
	}
	cleanup := func() {
		_ = file.Close()
		_ = os.Remove(file.Name())
	}
	buffer := make([]byte, 1024*1024)
	var written int64
	for {
		if err := ctx.Err(); err != nil {
			cleanup()
			return "", nil, err
		}
		read, readErr := source.Read(buffer)
		if read > 0 {
			written += int64(read)
			if written > expectedSize || written > runtimeartifact.MaxCustodyBytes {
				cleanup()
				return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			if _, err := file.Write(buffer[:read]); err != nil {
				cleanup()
				return "", nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "failed to write temporary artifact file"})
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			cleanup()
			return "", nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, readErr, grpcerr.ReasonOptions{Message: "failed to read Runtime artifact"})
		}
	}
	if written != expectedSize {
		cleanup()
		return "", nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, fmt.Errorf("artifact size mismatch"), grpcerr.ReasonOptions{Message: "Runtime artifact size mismatch"})
	}
	if err := file.Close(); err != nil {
		cleanup()
		return "", nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "failed to close temporary artifact file"})
	}
	return file.Name(), func() { _ = os.Remove(file.Name()) }, nil
}

func inlineRemoteTextGenerateImageURL(location string, mimeType string) (string, error) {
	value := strings.TrimSpace(location)
	if value == "" {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "data:") {
		return value, nil
	}
	pathValue := value
	if strings.HasPrefix(lower, "file://") {
		parsed, err := url.Parse(value)
		if err != nil {
			return "", grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{
				Message: "artifact file URL is invalid",
			})
		}
		pathValue = parsed.Path
	}
	if !looksLikeTextGenerateLocalFilesystemPath(pathValue) {
		return value, nil
	}
	payload, err := os.ReadFile(pathValue)
	if err != nil {
		return value, nil
	}
	if len(payload) == 0 {
		return value, nil
	}
	resolvedMIME := firstNonEmpty(strings.TrimSpace(mimeType), inferMimeTypeFromLocation(pathValue), strings.TrimSpace(http.DetectContentType(payload)))
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(resolvedMIME)), "image/") {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return "data:" + resolvedMIME + ";base64," + base64.StdEncoding.EncodeToString(payload), nil
}

func looksLikeTextGenerateLocalFilesystemPath(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	if strings.HasPrefix(trimmed, "/") || strings.HasPrefix(trimmed, "\\") {
		return true
	}
	return len(trimmed) >= 3 && trimmed[1] == ':' && (trimmed[2] == '\\' || trimmed[2] == '/')
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
