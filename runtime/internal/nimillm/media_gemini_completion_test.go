package nimillm

import (
	"context"
	"encoding/base64"
	"testing"
)

func TestGeminiMediaRequiresCompletedCandidate(t *testing.T) {
	for _, finish := range []string{"", "MAX_TOKENS", "SAFETY", "OTHER", "STOP"} {
		t.Run(finish, func(t *testing.T) {
			candidate := func(mime string, data []byte) map[string]any {
				return map[string]any{"finishReason": finish, "content": map[string]any{"parts": []any{
					map[string]any{"inlineData": map[string]any{"mimeType": mime, "data": base64.StdEncoding.EncodeToString(data)}},
				}}}
			}
			wantSuccess := finish == "STOP"
			image, _, _ := geminiFinalInlineImage(context.Background(), []any{candidate("image/png", []byte("image-body"))})
			if (len(image) > 0) != wantSuccess {
				t.Errorf("image candidate finish=%q accepted=%v", finish, len(image) > 0)
			}
			_, _, speechErr := geminiTTSAudioResult(map[string]any{"candidates": []any{candidate("audio/wav", testGeminiTTSWAV())}})
			if (speechErr == nil) != wantSuccess {
				t.Errorf("speech candidate finish=%q error=%v", finish, speechErr)
			}
			_, musicErr := geminiLyriaInlineMP3(map[string]any{"candidates": []any{candidate("audio/mpeg", []byte("ID3-test-body"))}})
			if (musicErr == nil) != wantSuccess {
				t.Errorf("music candidate finish=%q error=%v", finish, musicErr)
			}
		})
	}
}
