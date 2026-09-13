package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// This exercises the real Local App owner, Cloud composition and HTTP mapping.
// The provider is a test server: reaching it does not prove video generation.
func TestLocalAppWanT2VReferenceAudioReachesProvider(t *testing.T) {
	for _, tc := range []struct {
		name, prompt, audioURL, wantPrompt string
		texts                              []string
	}{
		{name: "content only", texts: []string{"A short harbor scene.", "At sunset."}, wantPrompt: "A short harbor scene.\nAt sunset."},
		{name: "top-level only", prompt: "A short harbor scene.", wantPrompt: "A short harbor scene."},
		{name: "top-level and content", prompt: "A short harbor scene.", texts: []string{"At sunset."}, wantPrompt: "A short harbor scene.\nAt sunset."},
		{name: "top-level and reference audio", prompt: "A short harbor scene.", audioURL: "https://media.example.test/reference.mp3", wantPrompt: "A short harbor scene."},
		{name: "SDK mirror and audio", prompt: "A short harbor scene.", texts: []string{"A short harbor scene.", "At sunset."}, audioURL: "https://media.example.test/reference.mp3", wantPrompt: "A short harbor scene.\nAt sunset."},
		{name: "later repeated text is intentional", prompt: "A short harbor scene.", texts: []string{"A short harbor scene.", "At sunset.", "A short harbor scene."}, wantPrompt: "A short harbor scene.\nAt sunset.\nA short harbor scene."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requests := make(chan map[string]any, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/aigc/video-generation/video-synthesis" {
					http.NotFound(w, r)
					return
				}
				var payload map[string]any
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Errorf("decode provider request: %v", err)
				}
				select {
				case requests <- payload:
				default:
					t.Error("provider media rejection was retried")
				}
				// A provider-side media rejection must remain a failed Job.
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"code":"InvalidParameter","message":"reference audio is outside the provider media limits"}`))
			}))
			defer server.Close()

			fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "wan2.7-t2v", server.URL, Config{AllowLoopbackEndpoint: true})
			target, err := structpb.NewStruct(map[string]any{
				"provider": fixture.descriptor.GetProvider(), "providerModelId": fixture.descriptor.GetProviderModelId(),
				"remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId(),
			})
			if err != nil {
				t.Fatal(err)
			}
			intent := &runtimev1.AIConfigCapabilityIntent{
				CapabilityContract: "video.generate",
				Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
					ConnectorRef: fixture.connectorID,
					Implementation: &runtimev1.CapabilityImplementationIdentity{
						ImplementationId: "cloud.video.generate.dashscope", DriverId: "nimi.runtime.driver.dashscope", DriverDialect: "provider/media-v1",
					},
					ProviderModelTarget: target,
				}},
			}
			if err := overwriteAIConfigStoreForTest(context.Background(), fixture.service.aiConfigStore, "user-001", appAIConfig("nimi.realm-world-studio", intent)); err != nil {
				t.Fatal(err)
			}
			ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
				AccountID: "user-001", AppID: "nimi.realm-world-studio", RegisteredAppSubject: "protected-world-studio",
				Operation: accountservice.LocalAppOperationScenarioJobSubmit, AuthorityClass: localappop.AuthorityClassAppAccess,
				OperationCapability: localappop.AppOperationIDScenarioJobSubmit,
			})
			var content []*runtimev1.VideoContentItem
			for _, text := range tc.texts {
				content = append(content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: text})
			}
			if tc.audioURL != "" {
				content = append(content, &runtimev1.VideoContentItem{
					Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO,
					AudioUrl: &runtimev1.VideoContentAudioURL{Url: tc.audioURL},
				})
			}
			request := &runtimev1.SubmitLocalAppScenarioJobRequest{
				Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{
					Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: tc.prompt, Content: content,
					Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: testInt32(4), Resolution: "720p", Ratio: "16:9"},
				}},
			}
			original := proto.Clone(request)
			response, err := fixture.service.SubmitLocalAppScenarioJob(ctx, request)
			if err != nil {
				t.Fatalf("SubmitLocalAppScenarioJob: %v", err)
			}
			if !proto.Equal(request, original) {
				t.Fatal("normalization mutated the caller request")
			}
			decision, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
			decision.Operation = accountservice.LocalAppOperationScenarioJobGet
			decision.OperationCapability = localappop.AppOperationIDScenarioJobGet
			getCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
			var job *runtimev1.LocalAppScenarioJob
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				result, err := fixture.service.GetLocalAppScenarioJob(getCtx, &runtimev1.GetLocalAppScenarioJobRequest{JobId: response.GetJob().GetJobId()})
				if err != nil {
					t.Fatalf("GetLocalAppScenarioJob: %v", err)
				}
				job = result.GetJob()
				if isTerminalScenarioJobStatus(job.GetStatus()) {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || len(job.GetArtifacts()) != 0 {
				t.Fatalf("provider media rejection became a positive result: %v", job)
			}
			select {
			case payload := <-requests:
				input, ok := payload["input"].(map[string]any)
				if !ok || input["prompt"] != tc.wantPrompt {
					t.Fatalf("provider input = %#v", payload["input"])
				}
				if tc.audioURL == "" {
					if _, exists := input["audio_url"]; exists {
						t.Fatal("text-only request acquired an audio input")
					}
				} else if input["audio_url"] != tc.audioURL {
					t.Fatalf("audio_url = %v, want the admitted reference", input["audio_url"])
				}
			default:
				t.Fatalf("request never reached the provider: %v", job)
			}
		})
	}
}

func TestVideoReferenceAudioRetainsModeAndCatalogAdmission(t *testing.T) {
	svc := newTestService(nil)
	for _, tc := range []struct {
		name       string
		mode       runtimev1.VideoMode
		audioCount int
		noPrompt   bool
		wrongRole  bool
		image      bool
		provider   string
		model      string
		options    *runtimev1.VideoGenerationOptions
		textRole   runtimev1.VideoContentRole
		want       runtimev1.ReasonCode
	}{
		{name: "Wan declares one audio", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, audioCount: 1},
		{name: "Wan minimum seed", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, options: &runtimev1.VideoGenerationOptions{Seed: testInt64(0)}},
		{name: "Wan maximum seed", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, options: &runtimev1.VideoGenerationOptions{Seed: testInt64(2147483647)}},
		{name: "Wan negative seed", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, options: &runtimev1.VideoGenerationOptions{Seed: testInt64(-1)}, want: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "Wan unsigned maximum seed", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, options: &runtimev1.VideoGenerationOptions{Seed: testInt64(4294967295)}, want: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "Wan explicit zero duration", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(0)}, want: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "Wan explicit no audio", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, options: &runtimev1.VideoGenerationOptions{GenerateAudio: testBool(false)}, want: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "Wan explicit unsupported camera control", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, options: &runtimev1.VideoGenerationOptions{CameraFixed: testBool(false)}, want: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "TEXT requires PROMPT role", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, textRole: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME, want: runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID},
		{name: "Wan rejects two audio references", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, audioCount: 2, want: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "audio does not supply the prompt", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, audioCount: 1, noPrompt: true, want: runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID},
		{name: "audio role must be reference audio", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, audioCount: 1, wrongRole: true, want: runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID},
		{name: "T2V still rejects reference images", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, audioCount: 1, image: true, want: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "first frame remains required", mode: runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, audioCount: 1, want: runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID},
		{name: "first and last frames remain required", mode: runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST, audioCount: 1, want: runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID},
		{name: "reference image remains required", mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, audioCount: 1, want: runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID},
		{name: "undeclared model audio support", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, audioCount: 1, provider: "openai", model: "sora-2", want: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "audio in another mode does not grant T2V", mode: runtimev1.VideoMode_VIDEO_MODE_T2V, audioCount: 1, provider: "dashscope", model: "wan2.7-i2v", want: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spec := &runtimev1.VideoGenerateScenarioSpec{Mode: tc.mode, Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(4)}}
			if tc.options != nil {
				spec.Options = tc.options
			}
			if !tc.noPrompt {
				role := runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT
				if tc.textRole != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_UNSPECIFIED {
					role = tc.textRole
				}
				spec.Content = append(spec.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: role, Text: "A harbor."})
			}
			for range tc.audioCount {
				role := runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO
				if tc.wrongRole {
					role = runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO
				}
				spec.Content = append(spec.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL, Role: role, AudioUrl: &runtimev1.VideoContentAudioURL{Url: "https://media.example.test/reference.mp3"}})
			}
			if tc.image {
				spec.Content = append(spec.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://media.example.test/reference.png"}})
			}
			provider, model := tc.provider, tc.model
			if provider == "" {
				provider, model = "dashscope", "wan2.7-t2v"
			}
			err := validateVideoGenerateScenarioSpec(spec)
			if err == nil {
				err = svc.validateVideoGenerateAgainstCatalog(context.Background(), provider, model, spec)
			}
			if tc.want == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
				if err != nil {
					t.Fatal(err)
				}
			} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != tc.want {
				t.Fatalf("reason = %v, want %v; error = %v", reason, tc.want, err)
			}
		})
	}
}
