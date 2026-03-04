package nimillm

import (
	"context"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

type probeSpeechVoicesResponse struct {
	Voices []probeSpeechVoice `json:"voices"`
	Data   []probeSpeechVoice `json:"data"`
	Items  []probeSpeechVoice `json:"items"`
}

type probeSpeechVoice struct {
	ID             string   `json:"id"`
	VoiceID        string   `json:"voice_id"`
	Voice          string   `json:"voice"`
	Name           string   `json:"name"`
	DisplayName    string   `json:"display_name"`
	Lang           string   `json:"lang"`
	Language       string   `json:"language"`
	Locale         string   `json:"locale"`
	SupportedLangs []string `json:"supported_langs"`
	Languages      []string `json:"languages"`
	Models         []string `json:"models"`
	Model          string   `json:"model"`
}

// ListSpeechVoices probes provider voice discovery endpoints.
func (b *Backend) ListSpeechVoices(ctx context.Context, modelID string) ([]*runtimev1.SpeechVoiceDescriptor, error) {
	if b == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	paths := []string{"/v1/audio/voices", "/v1/voices", "/voices"}
	var lastErr error
	for _, path := range paths {
		var payload probeSpeechVoicesResponse
		if err := b.getJSON(ctx, path, &payload); err != nil {
			lastErr = err
			if shouldRetryVoiceListPath(err) {
				continue
			}
			return nil, err
		}
		return mapProbeSpeechVoices(payload, modelID), nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
}

func mapProbeSpeechVoices(payload probeSpeechVoicesResponse, modelID string) []*runtimev1.SpeechVoiceDescriptor {
	entries := payload.Voices
	if len(entries) == 0 {
		entries = payload.Data
	}
	if len(entries) == 0 {
		entries = payload.Items
	}
	if len(entries) == 0 {
		return nil
	}

	normalizedTarget := normalizeComparableVoiceModelID(modelID)
	targetBase := voiceModelIDBase(normalizedTarget)
	seen := make(map[string]struct{}, len(entries))
	out := make([]*runtimev1.SpeechVoiceDescriptor, 0, len(entries))
	for _, entry := range entries {
		if !voiceSupportsTargetModel(entry, normalizedTarget, targetBase) {
			continue
		}
		voiceID := firstNonEmptyString(
			entry.ID,
			entry.VoiceID,
			entry.Voice,
			entry.Name,
			entry.DisplayName,
		)
		if voiceID == "" {
			continue
		}
		voiceKey := strings.ToLower(voiceID)
		if _, exists := seen[voiceKey]; exists {
			continue
		}
		seen[voiceKey] = struct{}{}

		name := firstNonEmptyString(entry.DisplayName, entry.Name, voiceID)
		lang := firstNonEmptyString(entry.Lang, entry.Language, entry.Locale)
		supportedLangs := normalizeStringSlice(entry.SupportedLangs)
		if len(supportedLangs) == 0 {
			supportedLangs = normalizeStringSlice(entry.Languages)
		}
		out = append(out, &runtimev1.SpeechVoiceDescriptor{
			VoiceId:        voiceID,
			Name:           name,
			Lang:           lang,
			SupportedLangs: supportedLangs,
		})
	}
	return out
}

func shouldRetryVoiceListPath(err error) bool {
	st, ok := status.FromError(err)
	if !ok {
		return false
	}
	switch st.Code() {
	case codes.NotFound, codes.Unimplemented, codes.FailedPrecondition:
		return true
	default:
		return false
	}
}

func voiceSupportsTargetModel(entry probeSpeechVoice, normalizedTarget string, targetBase string) bool {
	if normalizedTarget == "" {
		return true
	}
	if len(entry.Models) > 0 {
		for _, model := range entry.Models {
			if voiceModelMatchesTarget(model, normalizedTarget, targetBase) {
				return true
			}
		}
		return false
	}
	if strings.TrimSpace(entry.Model) != "" {
		return voiceModelMatchesTarget(entry.Model, normalizedTarget, targetBase)
	}
	return true
}

func voiceModelMatchesTarget(candidate string, normalizedTarget string, targetBase string) bool {
	normalizedCandidate := normalizeComparableVoiceModelID(candidate)
	if normalizedCandidate == "" {
		return false
	}
	if normalizedCandidate == normalizedTarget {
		return true
	}
	return voiceModelIDBase(normalizedCandidate) == targetBase
}

func normalizeComparableVoiceModelID(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.TrimPrefix(normalized, "cloud/")
	normalized = strings.TrimPrefix(normalized, "token/")
	normalized = strings.TrimPrefix(normalized, "local/")
	return normalized
}

func voiceModelIDBase(value string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return ""
	}
	segments := strings.Split(normalized, "/")
	return strings.TrimSpace(segments[len(segments)-1])
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func normalizeStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}
