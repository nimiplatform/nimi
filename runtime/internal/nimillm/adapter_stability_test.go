package nimillm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
)

func stabilityTestPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	img.Set(10, 10, color.NRGBA{R: 200, A: 255})
	var output bytes.Buffer
	if err := png.Encode(&output, img); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
func stabilityTestHeaders(w http.ResponseWriter, mimeType string) {
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("finish-reason", "SUCCESS")
	w.Header().Set("seed", "37")
}
func TestStabilityNativeImagesUseExactMultipartEngineAndOwnedInput(t *testing.T) {
	for _, tc := range []struct{ model, engine, native string }{{"stable-image-core", "core", ""}, {"stable-image-ultra", "ultra", ""}, {"stable-diffusion-3.5-large", "sd3", "sd3.5-large"}, {"stable-diffusion-3.5-large-turbo", "sd3", "sd3.5-large-turbo"}, {"stable-diffusion-3.5-medium", "sd3", "sd3.5-medium"}} {
		t.Run(tc.model, func(t *testing.T) {
			data := stabilityTestPNG(t)
			for _, owned := range []bool{false, true} {
				if owned && tc.engine == "core" {
					continue
				}
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method != "POST" || r.URL.Path != "/v2beta/stable-image/generate/"+tc.engine || r.Header.Get("Authorization") != "Bearer fixture" || r.Header.Get("Accept") != "image/*" {
						t.Errorf("wrong native request %s %s", r.Method, r.URL.Path)
					}
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Error(err)
						w.WriteHeader(400)
						return
					}
					defer r.MultipartForm.RemoveAll()
					if r.FormValue("model") != tc.native || r.FormValue("output_format") != "png" || r.FormValue("seed") != "37" || r.FormValue("prompt") != "灯塔" || r.FormValue("response_format") != "" {
						t.Errorf("multipart fields %+v", r.MultipartForm.Value)
					}
					if owned {
						file, _, err := r.FormFile("image")
						if err != nil {
							t.Error(err)
							return
						}
						defer file.Close()
						raw, _ := io.ReadAll(file)
						if !bytes.Equal(raw, data) || r.FormValue("strength") != "0.5" || (tc.engine == "sd3" && r.FormValue("mode") != "image-to-image") {
							t.Error("owned image condition lost")
						}
					}
					stabilityTestHeaders(w, "image/png")
					w.Write(data)
				}))
				spec := &runtimev1.ImageGenerateScenarioSpec{Prompt: "灯塔", OutputFormat: "png", ResponseFormat: "b64_json", Seed: proto.Int64(37)}
				ctx := context.Background()
				if owned {
					spec.ReferenceImageArtifactId = "owned"
					spec.Strength = proto.Float32(.5)
					digest := sha256.Sum256(data)
					reference := &CapturedMediaReference{ArtifactID: "owned", MIMEType: "image/png", Bytes: data, SHA256: hex.EncodeToString(digest[:])}
					if err := ValidateCloudImageReferenceRequest("stability", tc.model, spec, reference); err != nil {
						t.Fatal(err)
					}
					ctx = WithImageReference(ctx, reference)
				}
				req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: spec}}}
				artifacts, usage, _, err := ExecuteStabilityImage(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, req, tc.model)
				server.Close()
				if err != nil || len(artifacts) != 1 || usage != nil {
					t.Fatalf("native image %v %v", artifacts, err)
				}
				a := artifacts[0]
				if !bytes.Equal(a.GetBytes(), data) || a.GetSeed() != 37 || a.Width != 64 || a.Height != 64 || a.GetMetadata().GetFields()["seed"] != nil {
					t.Fatal("native image facts lost or duplicated")
				}
			}
		})
	}
}

func TestStabilityAudio2And25UseMultipartAndMeasuredReference(t *testing.T) {
	mp3, err := os.ReadFile("testdata/tone-24k.mp3")
	if err != nil {
		t.Fatal(err)
	}
	for _, model := range []string{"stable-audio-2", "stable-audio-2.5"} {
		for _, owned := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/reference=%v", model, owned), func(t *testing.T) {
				wav := testGeminiTTSWAV()
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					path := "/v2beta/audio/stable-audio-2/text-to-audio"
					if owned {
						path = "/v2beta/audio/stable-audio-2/audio-to-audio"
					}
					if r.URL.Path != path || r.Header.Get("Accept") != "audio/*" {
						t.Errorf("path %s", r.URL.Path)
					}
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Error(err)
						return
					}
					defer r.MultipartForm.RemoveAll()
					if r.FormValue("model") != model || r.FormValue("output_format") != "mp3" || r.FormValue("duration") != "10" || r.FormValue("seed") != "37" || r.FormValue("negative_prompt") != "" {
						t.Errorf("fields %+v", r.MultipartForm.Value)
					}
					if owned {
						f, _, err := r.FormFile("audio")
						if err != nil {
							t.Error(err)
							return
						}
						raw, _ := io.ReadAll(f)
						f.Close()
						if !bytes.Equal(raw, wav) || r.FormValue("strength") != "0.5" {
							t.Error("reference ignored")
						}
					}
					stabilityTestHeaders(w, "audio/mpeg")
					w.Write(mp3)
				}))
				defer server.Close()
				req := newMusicJobRequest(model, "piano")
				req.GetSpec().GetMusicGenerate().DurationSeconds = 10
				req.GetSpec().GetMusicGenerate().Seed = proto.Uint32(37)
				ctx := context.Background()
				if owned {
					req.GetSpec().GetMusicGenerate().AudioReference = &runtimev1.MusicAudioInput{ArtifactId: "owned"}
					ctx = WithMusicReferenceAudio(ctx, &MusicReferenceAudio{ArtifactID: "owned", MIMEType: "audio/wav", Bytes: wav, DurationSeconds: .1})
				}
				// Duration admission is tested separately; this transport unit only checks
				// that the exact already-captured bytes reach the provider unmodified.
				artifacts, usage, _, err := ExecuteStabilityMusic(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, req, model)
				if err != nil || usage != nil || len(artifacts) != 1 || !bytes.Equal(artifacts[0].GetBytes(), mp3) || artifacts[0].GetMetadata().GetFields()["actual_seed"].GetNumberValue() != 37 {
					t.Fatalf("native audio %v %v", artifacts, err)
				}
			})
		}
	}
}
func TestStabilityAudio3OriginalTaskPollingAndStreamedCustody(t *testing.T) {
	id := strings.Repeat("a", 64)
	var creates, gets atomic.Int32
	wav := testGeminiTTSWAV()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture" {
			t.Error("missing scoped credential")
		}
		switch r.Method + " " + r.URL.Path {
		case "POST /v2beta/audio/stable-audio/text-to-audio":
			creates.Add(1)
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				return
			}
			defer r.MultipartForm.RemoveAll()
			if r.FormValue("model") != "stable-audio-3" || r.FormValue("output_format") != "wav" || r.FormValue("duration") != "380" {
				t.Error("audio3 request mapping")
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(202)
			json.NewEncoder(w).Encode(map[string]string{"id": id})
		case "GET /v2beta/audio/results/" + id:
			if gets.Add(1) == 1 {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(202)
				json.NewEncoder(w).Encode(map[string]string{"id": id, "status": "in-progress"})
				return
			}
			stabilityTestHeaders(w, "audio/wav")
			w.Write(wav)
		default:
			t.Errorf("unexpected operation %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	cfg := MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}
	request := newMusicJobRequest("stable-audio-3", "piano")
	request.GetSpec().GetMusicGenerate().DurationSeconds = 380
	request.GetSpec().GetMusicGenerate().Seed = proto.Uint32(37)
	if _, _, _, err := ExecuteStabilityMusic(context.Background(), cfg, request, "stable-audio-3"); err == nil || creates.Load() != 0 {
		t.Fatal("created without durable owner")
	}
	var receipt *NativeTaskReceipt
	ctx := WithNativeTaskPublisher(context.Background(), func(value *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(value); return nil })
	_, _, taskID, err := ExecuteStabilityMusic(ctx, cfg, request, "stable-audio-3")
	if !errors.Is(err, ErrNativeTaskYielded) || taskID != id || receipt == nil || creates.Load() != 1 {
		t.Fatalf("receipt %v %v", receipt, err)
	}
	if o, done, err := ObserveNativeTask(context.Background(), cfg, receipt); err != nil || done || o != nil {
		t.Fatal("pending response was a result")
	}
	observed, done, err := ObserveNativeTask(context.Background(), cfg, receipt)
	if err != nil || !done || len(observed.Artifacts) != 1 || len(observed.Artifacts[0].GetBytes()) != 0 {
		t.Fatalf("bodyless observation %v %v", observed, err)
	}
	bad := CloneNativeTaskObservation(observed)
	bad.Artifacts[0].Uri = "https://attacker.invalid/audio.wav"
	if _, err := OpenNativeTaskArtifacts(context.Background(), cfg, receipt, bad); err == nil {
		t.Fatal("credentialed arbitrary URI accepted")
	}
	bodies, err := OpenNativeTaskArtifacts(context.Background(), cfg, receipt, observed)
	if err != nil {
		t.Fatal(err)
	}
	body := bodies[receipt.Artifact.GetArtifactId()]
	data, err := io.ReadAll(body.Stream)
	body.Stream.Close()
	if err != nil || !bytes.Equal(data, wav) || creates.Load() != 1 || gets.Load() != 3 || observed.Artifacts[0].Uri != "" || observed.Artifacts[0].GetMetadata().GetFields()["actual_seed"].GetNumberValue() != 37 {
		t.Fatal("original result custody lost")
	}
	if outcome, err := DeleteProviderAsyncTask(context.Background(), AdapterStabilityMusic, id, cfg); err != nil || outcome != ProviderTaskCleanupUnsupported {
		t.Fatal("invented cancellation receipt")
	}
}
func TestStabilityOriginalResultRejectsInvalidTerminalEvidence(t *testing.T) {
	id := strings.Repeat("b", 64)
	receipt := &NativeTaskReceipt{Version: 1, Adapter: AdapterStabilityMusic, Model: "stable-audio-3", TaskID: id, QueryPathTemplate: stabilityAudioQueryPath, Artifact: BinaryArtifact("audio/wav", nil, nil)}
	for _, tc := range []struct {
		name               string
		status             int
		finish, mime, body string
		done               bool
		reason             runtimev1.ReasonCode
	}{
		{"expired", 404, "", "", "", true, runtimev1.ReasonCode_AI_PROVIDER_TASK_EXPIRED},
		{"native moderation", 403, "", "application/json", `{"name":"content_moderation","errors":["request denied"]}`, true, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED},
		{"missing credits", 402, "", "application/json", `{}`, false, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED},
		{"request too large", 413, "", "application/json", `{}`, false, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE},
		{"filtered", 200, "CONTENT_FILTERED", "audio/wav", "", true, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED},
		{"unknown finish", 200, "", "audio/wav", "data", false, runtimev1.ReasonCode_AI_OUTPUT_INVALID},
		{"wrong mime", 200, "SUCCESS", "application/json", "{}", false, runtimev1.ReasonCode_AI_OUTPUT_INVALID},
		{"wrong pending id", 202, "", "application/json", `{"id":"wrong","status":"in-progress"}`, false, runtimev1.ReasonCode_AI_OUTPUT_INVALID},
		{"redirect", 302, "", "", "", false, runtimev1.ReasonCode_AI_OUTPUT_INVALID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", tc.mime)
				w.Header().Set("finish-reason", tc.finish)
				w.Header().Set("seed", "37")
				w.Header().Set("Location", "https://attacker.invalid/")
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			_, done, err := ObserveNativeTask(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, receipt)
			reason, _ := grpcerr.ExtractReasonCode(err)
			if reason != tc.reason || done != tc.done {
				t.Fatalf("terminal classification %v %v %v", done, reason, err)
			}
		})
	}
	for _, mutate := range []func(*NativeTaskReceipt){func(r *NativeTaskReceipt) { r.TaskID = "../" + id }, func(r *NativeTaskReceipt) { r.Model = "stable-audio-2.5" }, func(r *NativeTaskReceipt) { r.QueryPathTemplate = "/other/{task_id}" }} {
		invalid := CloneNativeTaskReceipt(receipt)
		mutate(invalid)
		if ValidateNativeTaskReceipt(invalid) == nil {
			t.Fatal("invalid receipt accepted")
		}
	}
}
func TestStabilityResultAcquisitionStreamsAndHonorsCancellation(t *testing.T) {
	id := strings.Repeat("d", 64)
	header := testGeminiTTSWAV()[:44]
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		stabilityTestHeaders(w, "audio/wav")
		w.Header().Set("Content-Length", "40000000")
		w.Write(header)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	cfg := MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}
	receipt := &NativeTaskReceipt{Version: 1, Adapter: AdapterStabilityMusic, Model: "stable-audio-3", TaskID: id, QueryPathTemplate: stabilityAudioQueryPath, Artifact: BinaryArtifact("audio/wav", nil, nil)}
	artifact := proto.Clone(receipt.Artifact).(*runtimev1.ScenarioArtifact)
	artifact.Uri = server.URL + "/v2beta/audio/results/" + id
	artifact.Metadata = ToStruct(map[string]any{"actual_seed": 37})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bodies, err := OpenNativeTaskArtifacts(ctx, cfg, receipt, &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{artifact}})
	if err != nil {
		t.Fatal(err)
	}
	body := bodies[artifact.GetArtifactId()]
	if body.Stream == nil || len(body.Bytes) != 0 {
		t.Fatal("large output buffered")
	}
	cancel()
	if _, err := io.Copy(io.Discard, body.Stream); err == nil {
		t.Fatal("cancellation ignored")
	}
	body.Stream.Close()
}

func TestStabilityOwnedReferenceDurationLimits(t *testing.T) {
	for _, tc := range []struct {
		model   string
		seconds float64
		valid   bool
	}{{"stable-audio-3", 6, true}, {"stable-audio-3", 380, true}, {"stable-audio-3", 5.99, false}, {"stable-audio-3", 380.01, false}, {"stable-audio-2.5", 190, true}, {"stable-audio-2.5", 190.01, false}} {
		ref := &MusicReferenceAudio{ArtifactID: "owned", MIMEType: "audio/wav", Bytes: testGeminiTTSWAV(), DurationSeconds: tc.seconds}
		if (ValidateStabilityMusicReference(tc.model, ref) == nil) != tc.valid {
			t.Fatalf("%s %.2f", tc.model, tc.seconds)
		}
	}
}
