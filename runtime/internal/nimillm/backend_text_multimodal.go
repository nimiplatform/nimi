package nimillm

import (
	"context"
	"encoding/base64"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

type openAIContentPart struct {
	Type       string            `json:"type"`
	Text       string            `json:"text,omitempty"`
	ImageURL   *openAIImageURL   `json:"image_url,omitempty"`
	InputAudio *openAIInputAudio `json:"input_audio,omitempty"`
}

type openAIImageURL struct {
	URL    string `json:"url"`
	Detail string `json:"detail,omitempty"`
}

type openAIInputAudio struct {
	Data   string `json:"data"`
	Format string `json:"format"`
}

type openAIMultimodalMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
	Name    string `json:"name,omitempty"`
}

type llamaMessage struct {
	Role          string   `json:"role"`
	Content       string   `json:"content,omitempty"`
	StringContent string   `json:"string_content,omitempty"`
	StringImages  []string `json:"string_images,omitempty"`
	StringVideos  []string `json:"string_videos,omitempty"`
	StringAudios  []string `json:"string_audios,omitempty"`
	Name          string   `json:"name,omitempty"`
}

func (b *Backend) supportsLlamaTextMultimodal() bool {
	lower := strings.ToLower(strings.TrimSpace(b.Name))
	return strings.Contains(lower, "llama")
}

func (b *Backend) supportsProviderNativeOpenAITextMultimodal() bool {
	lower := strings.ToLower(strings.TrimSpace(b.Name))
	return strings.Contains(lower, "openai") && !strings.Contains(lower, "llama")
}

func hasUnsupportedOpenAITextChatParts(input []*runtimev1.ChatMessage) bool {
	for _, msg := range input {
		for _, part := range msg.GetParts() {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT,
				runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL,
				runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
				continue
			default:
				return true
			}
		}
	}
	return false
}

func hasUnsupportedOpenAICompatibleTextChatParts(input []*runtimev1.ChatMessage) bool {
	for _, msg := range input {
		for _, part := range msg.GetParts() {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT,
				runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				continue
			default:
				return true
			}
		}
	}
	return false
}

func hasUnsupportedLlamaTextChatParts(input []*runtimev1.ChatMessage) bool {
	for _, msg := range input {
		for _, part := range msg.GetParts() {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT,
				runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL,
				runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL,
				runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
				continue
			default:
				return true
			}
		}
	}
	return false
}

func hasMultimodalParts(input []*runtimev1.ChatMessage) bool {
	for _, msg := range input {
		if len(msg.GetParts()) > 0 {
			return true
		}
	}
	return false
}

func buildTextChatMessages(ctx context.Context, systemPrompt string, input []*runtimev1.ChatMessage, backend *Backend) (any, error) {
	preferLlama := backend != nil && backend.supportsLlamaTextMultimodal()
	if hasMultimodalParts(input) {
		if preferLlama {
			if hasUnsupportedLlamaTextChatParts(input) {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
			}
			messages := buildLlamaTextMessages(systemPrompt, input)
			if len(messages) == 0 {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			return messages, nil
		}
		if backend != nil && backend.supportsProviderNativeOpenAITextMultimodal() {
			if hasUnsupportedOpenAITextChatParts(input) {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
			}
			messages, err := backend.buildOpenAIProviderNativeMessages(ctx, systemPrompt, input)
			if err != nil {
				return nil, err
			}
			if len(messages) == 0 {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			return messages, nil
		}
		if hasUnsupportedOpenAICompatibleTextChatParts(input) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		messages := buildOpenAIMultimodalMessages(systemPrompt, input)
		if len(messages) == 0 {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		return messages, nil
	}
	messages := buildOpenAIMessages(systemPrompt, input)
	if len(messages) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return messages, nil
}

func buildOpenAIMultimodalMessages(systemPrompt string, input []*runtimev1.ChatMessage) []openAIMultimodalMessage {
	messages := make([]openAIMultimodalMessage, 0, len(input)+1)
	if prompt := strings.TrimSpace(systemPrompt); prompt != "" {
		messages = append(messages, openAIMultimodalMessage{Role: "system", Content: prompt})
	}
	for _, item := range input {
		parts := item.GetParts()
		role := strings.TrimSpace(item.GetRole())
		if role == "" {
			role = "user"
		}
		if len(parts) == 0 {
			content := strings.TrimSpace(item.GetContent())
			if content == "" {
				continue
			}
			messages = append(messages, openAIMultimodalMessage{
				Role:    role,
				Content: content,
				Name:    strings.TrimSpace(item.GetName()),
			})
			continue
		}
		contentParts := make([]openAIContentPart, 0, len(parts))
		for _, part := range parts {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
				text := strings.TrimSpace(part.GetText())
				if text != "" {
					contentParts = append(contentParts, openAIContentPart{Type: "text", Text: text})
				}
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				imgURL := part.GetImageUrl()
				if imgURL != nil {
					value := strings.TrimSpace(imgURL.GetUrl())
					if value != "" {
						contentPart := openAIContentPart{
							Type:     "image_url",
							ImageURL: &openAIImageURL{URL: value},
						}
						if detail := strings.TrimSpace(imgURL.GetDetail()); detail != "" {
							contentPart.ImageURL.Detail = detail
						}
						contentParts = append(contentParts, contentPart)
					}
				}
			}
		}
		if len(contentParts) == 0 {
			continue
		}
		messages = append(messages, openAIMultimodalMessage{
			Role:    role,
			Content: contentParts,
			Name:    strings.TrimSpace(item.GetName()),
		})
	}
	return messages
}

func buildLlamaTextMessages(systemPrompt string, input []*runtimev1.ChatMessage) []llamaMessage {
	messages := make([]llamaMessage, 0, len(input)+1)
	if prompt := strings.TrimSpace(systemPrompt); prompt != "" {
		messages = append(messages, llamaMessage{
			Role:          "system",
			Content:       prompt,
			StringContent: prompt,
		})
	}
	for _, item := range input {
		role := strings.TrimSpace(item.GetRole())
		if role == "" {
			role = "user"
		}
		if len(item.GetParts()) == 0 {
			content := strings.TrimSpace(item.GetContent())
			if content == "" {
				continue
			}
			messages = append(messages, llamaMessage{
				Role:          role,
				Content:       content,
				StringContent: content,
				Name:          strings.TrimSpace(item.GetName()),
			})
			continue
		}

		message := llamaMessage{
			Role: role,
			Name: strings.TrimSpace(item.GetName()),
		}
		textParts := make([]string, 0, len(item.GetParts()))
		for _, part := range item.GetParts() {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
				if text := strings.TrimSpace(part.GetText()); text != "" {
					textParts = append(textParts, text)
				}
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				if imageURL := strings.TrimSpace(part.GetImageUrl().GetUrl()); imageURL != "" {
					message.StringImages = append(message.StringImages, imageURL)
				}
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
				if videoURL := strings.TrimSpace(part.GetVideoUrl()); videoURL != "" {
					message.StringVideos = append(message.StringVideos, videoURL)
				}
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
				if audioURL := strings.TrimSpace(part.GetAudioUrl()); audioURL != "" {
					message.StringAudios = append(message.StringAudios, audioURL)
				}
			}
		}
		if len(textParts) > 0 {
			text := strings.Join(textParts, "\n")
			message.Content = text
			message.StringContent = text
		} else if fallback := strings.TrimSpace(item.GetContent()); fallback != "" {
			message.Content = fallback
			message.StringContent = fallback
		}
		if message.StringContent == "" && len(message.StringImages) == 0 && len(message.StringVideos) == 0 && len(message.StringAudios) == 0 {
			continue
		}
		messages = append(messages, message)
	}
	return messages
}

func (b *Backend) buildOpenAIProviderNativeMessages(ctx context.Context, systemPrompt string, input []*runtimev1.ChatMessage) ([]openAIMultimodalMessage, error) {
	messages := make([]openAIMultimodalMessage, 0, len(input)+1)
	if prompt := strings.TrimSpace(systemPrompt); prompt != "" {
		messages = append(messages, openAIMultimodalMessage{Role: "system", Content: prompt})
	}
	for _, item := range input {
		role := strings.TrimSpace(item.GetRole())
		if role == "" {
			role = "user"
		}
		if len(item.GetParts()) == 0 {
			content := strings.TrimSpace(item.GetContent())
			if content == "" {
				continue
			}
			messages = append(messages, openAIMultimodalMessage{
				Role:    role,
				Content: content,
				Name:    strings.TrimSpace(item.GetName()),
			})
			continue
		}

		contentParts := make([]openAIContentPart, 0, len(item.GetParts()))
		for _, part := range item.GetParts() {
			if part == nil {
				continue
			}
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
				if text := strings.TrimSpace(part.GetText()); text != "" {
					contentParts = append(contentParts, openAIContentPart{Type: "text", Text: text})
				}
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				contentPart, err := b.buildOpenAIImageContentPart(ctx, part.GetImageUrl())
				if err != nil {
					return nil, err
				}
				if contentPart.Type != "" {
					contentParts = append(contentParts, contentPart)
				}
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
				contentPart, err := b.buildOpenAIAudioContentPart(ctx, part.GetAudioUrl())
				if err != nil {
					return nil, err
				}
				if contentPart.Type != "" {
					contentParts = append(contentParts, contentPart)
				}
			default:
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
			}
		}
		if len(contentParts) == 0 {
			continue
		}
		messages = append(messages, openAIMultimodalMessage{
			Role:    role,
			Content: contentParts,
			Name:    strings.TrimSpace(item.GetName()),
		})
	}
	return messages, nil
}

func (b *Backend) buildOpenAIImageContentPart(ctx context.Context, img *runtimev1.ChatContentImageURL) (openAIContentPart, error) {
	if img == nil {
		return openAIContentPart{}, nil
	}
	location := strings.TrimSpace(img.GetUrl())
	if location == "" {
		return openAIContentPart{}, nil
	}
	if isRemoteHTTPURL(location) {
		part := openAIContentPart{
			Type:     "image_url",
			ImageURL: &openAIImageURL{URL: location},
		}
		if detail := strings.TrimSpace(img.GetDetail()); detail != "" {
			part.ImageURL.Detail = detail
		}
		return part, nil
	}
	payload, mimeType, err := b.readInlineMediaBytes(ctx, location)
	if err != nil {
		return openAIContentPart{}, err
	}
	if mimeType == "" {
		mimeType = inferInlineMediaType(location, payload)
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "image/") {
		return openAIContentPart{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	part := openAIContentPart{
		Type: "image_url",
		ImageURL: &openAIImageURL{
			URL: "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(payload),
		},
	}
	if detail := strings.TrimSpace(img.GetDetail()); detail != "" {
		part.ImageURL.Detail = detail
	}
	return part, nil
}

func (b *Backend) buildOpenAIAudioContentPart(ctx context.Context, location string) (openAIContentPart, error) {
	payload, mimeType, err := b.readInlineMediaBytes(ctx, location)
	if err != nil {
		return openAIContentPart{}, err
	}
	format, err := normalizeOpenAIInputAudioFormat(mimeType, location, payload)
	if err != nil {
		return openAIContentPart{}, err
	}
	return openAIContentPart{
		Type: "input_audio",
		InputAudio: &openAIInputAudio{
			Data:   base64.StdEncoding.EncodeToString(payload),
			Format: format,
		},
	}, nil
}

func (b *Backend) readInlineMediaBytes(ctx context.Context, location string) ([]byte, string, error) {
	value := strings.TrimSpace(location)
	if value == "" {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if strings.HasPrefix(strings.ToLower(value), "data:") {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if isRemoteHTTPURL(value) {
		if err := endpointsec.ValidateEndpoint(value, b != nil && b.allowLoopbackEndpoint); err != nil {
			return nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, value, nil)
		if err != nil {
			return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		resp, err := b.do(request)
		if err != nil {
			return nil, "", MapProviderRequestError(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, "", MapProviderHTTPError(resp.StatusCode, nil)
		}
		payload, err := io.ReadAll(io.LimitReader(resp.Body, maxInlineOpenAIMediaBytes+1))
		if err != nil {
			return nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		if len(payload) == 0 {
			return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if len(payload) > maxInlineOpenAIMediaBytes {
			return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		return payload, strings.TrimSpace(resp.Header.Get("Content-Type")), nil
	}
	path := value
	if strings.HasPrefix(strings.ToLower(value), "file://") {
		parsed, err := url.Parse(value)
		if err == nil && strings.TrimSpace(parsed.Path) != "" {
			path = parsed.Path
		}
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if len(payload) == 0 {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if len(payload) > maxInlineOpenAIMediaBytes {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return payload, mime.TypeByExtension(strings.ToLower(filepath.Ext(path))), nil
}

func isRemoteHTTPURL(location string) bool {
	lower := strings.ToLower(strings.TrimSpace(location))
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

func inferInlineMediaType(location string, payload []byte) string {
	if mimeType := strings.TrimSpace(mime.TypeByExtension(strings.ToLower(filepath.Ext(strings.TrimSpace(location))))); mimeType != "" {
		return mimeType
	}
	return strings.TrimSpace(http.DetectContentType(payload))
}

func normalizeOpenAIInputAudioFormat(mimeType string, location string, payload []byte) (string, error) {
	lowerMime := strings.ToLower(strings.TrimSpace(mimeType))
	switch lowerMime {
	case "audio/wav", "audio/x-wav":
		return "wav", nil
	case "audio/mpeg", "audio/mp3":
		return "mp3", nil
	}
	switch strings.ToLower(filepath.Ext(strings.TrimSpace(location))) {
	case ".wav":
		return "wav", nil
	case ".mp3":
		return "mp3", nil
	}
	detected := strings.ToLower(strings.TrimSpace(http.DetectContentType(payload)))
	switch detected {
	case "audio/wav", "audio/x-wav":
		return "wav", nil
	case "audio/mpeg", "audio/mp3":
		return "mp3", nil
	default:
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
}
