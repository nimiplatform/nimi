package nimillm

import (
	"bytes"
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestElevenLabsMusicConsumesCapturedVideoWithoutURLOrTextSubstitution(t *testing.T) {
	video := []byte("owned-test-video-custody") // Transport fixture, never a playable App output.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/music/video-to-music" || r.Header.Get("xi-api-key") != "owner-key" {
			t.Errorf("wrong selected native endpoint or credential header")
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		file, _, err := r.FormFile("videos[]")
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		data, _ := io.ReadAll(file)
		if !bytes.Equal(data, video) || r.FormValue("model_id") != "music_v2" || r.FormValue("description") != "quiet" {
			t.Errorf("captured condition or text changed")
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Write([]byte("ID3-transport-fixture"))
	}))
	defer server.Close()
	request := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: "quiet", VideoReference: &runtimev1.MusicVideoReference{ArtifactId: "clip-owned"}}}}}
	ctx := WithMusicReferenceVideo(context.Background(), &MusicReferenceVideo{ArtifactID: "clip-owned", MIMEType: "video/mp4", Bytes: video})
	artifacts, usage, _, err := ExecuteElevenLabsMusic(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "owner-key", AllowLoopbackEndpoint: true}, request, "music_v2")
	if err != nil || len(artifacts) != 1 {
		t.Fatalf("transport error %v", err)
	}
	if usage != nil {
		t.Fatal("binary response without usage acquired invented metering")
	}
	result, err := (&CloudProvider{}).ExecuteMediaAdapter(ctx, "elevenlabs_music_adapter", "job", request, "music_v2", &RemoteTarget{Endpoint: server.URL, APIKey: "owner-key", AllowLoopback: true}, noopJobStateUpdater{})
	if err != nil || len(result.Artifacts) != 1 {
		t.Fatalf("selected media dispatch did not consume the adapter: %v", err)
	}
	if result.Usage != nil {
		t.Fatal("media dispatcher invented provider usage")
	}
	if _, _, _, err := ExecuteElevenLabsMusic(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "owner-key", AllowLoopbackEndpoint: true}, request, "music_v2"); err == nil {
		t.Fatal("missing captured source was accepted")
	}
}
