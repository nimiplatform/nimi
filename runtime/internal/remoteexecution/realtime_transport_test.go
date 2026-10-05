package remoteexecution

import (
	"net/url"
	"testing"
)

func TestRealtimeTransportKeepsGeminiModelOutOfURL(t *testing.T) {
	endpoint := "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
	got, err := realtimeProviderURL(endpoint, "gemini-3.8-live", false)
	if err != nil || got != endpoint {
		t.Fatalf("native endpoint=%q err=%v", got, err)
	}
	got, err = realtimeProviderURL("wss://api.openai.com/v1/realtime", "gpt-realtime-2.1", true)
	u, _ := url.Parse(got)
	if err != nil || u.Query().Get("model") != "gpt-realtime-2.1" {
		t.Fatalf("existing endpoint=%q err=%v", got, err)
	}
	for _, bad := range []string{"http://host/ws", "wss://secret@host/ws", "wss://host/ws#fragment"} {
		if _, err := realtimeProviderURL(bad, "model", false); err == nil {
			t.Fatalf("unsafe endpoint accepted: %s", bad)
		}
	}
}
