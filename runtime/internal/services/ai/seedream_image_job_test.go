package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
)

func TestSeedreamProtectedNativeGenerationAndOwnedEdit(t *testing.T) {
	var source bytes.Buffer
	if err := png.Encode(&source, image.NewRGBA(image.Rect(0, 0, 32, 32))); err != nil {
		t.Fatal(err)
	}
	for _, model := range []string{capabilitydriver.Seedream5ProModel, capabilitydriver.Seedream5FlashModel, capabilitydriver.Seedream5Model, capabilitydriver.Seedream45Model} {
		for _, responseFormat := range []string{"b64_json", "url"} {
			t.Run(model+"/"+responseFormat, func(t *testing.T) {
				owned := responseFormat == "url"
				width, format := 2048, "png"
				if capabilitydriver.SeedreamProFlash(model) {
					width = 1024
				}
				if model == capabilitydriver.Seedream45Model {
					format = "jpeg"
				}
				var encoded bytes.Buffer
				pixels := image.NewRGBA(image.Rect(0, 0, width, width))
				if format == "jpeg" {
					if err := jpeg.Encode(&encoded, pixels, nil); err != nil {
						t.Fatal(err)
					}
				} else if err := png.Encode(&encoded, pixels); err != nil {
					t.Fatal(err)
				}
				var calls, downloads atomic.Int32
				var failed atomic.Bool
				var endpoint string
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/result" {
						downloads.Add(1)
						if r.Header.Get("Authorization") != "" || r.Header.Get("X-Api-Key") != "" {
							t.Error("artifact credential leak")
						}
						w.Header().Set("Content-Type", "application/octet-stream")
						_, _ = w.Write(encoded.Bytes())
						return
					}
					calls.Add(1)
					var b map[string]any
					if json.NewDecoder(r.Body).Decode(&b) != nil {
						t.Error("invalid body")
						return
					}
					if r.URL.Path != "/proxy/api/v3/images/generations" || r.Header.Get("Authorization") != "Bearer test-key" || b["model"] != model || b["prompt"] != "A blue cup" || b["size"] != fmt.Sprintf("%dx%d", width, width) || b["response_format"] != responseFormat {
						t.Error("native mapping", b)
					}
					for _, key := range []string{"n", "input", "negative_prompt", "aspect_ratio", "quality", "style", "seed", "reference_images", "mask", "extensions", "watermark", "tools"} {
						if _, ok := b[key]; ok {
							t.Error("unrequested native field", key)
						}
					}
					if capabilitydriver.SeedreamProFlash(model) {
						if b["stream"] != nil || b["sequential_image_generation"] != nil {
							t.Error("unsupported group/stream fields")
						}
					} else if b["stream"] != false || b["sequential_image_generation"] != "disabled" {
						t.Error("finite single result not captured")
					}
					if model == capabilitydriver.Seedream45Model {
						if b["output_format"] != nil {
							t.Error("unsupported4.5 format field")
						}
					} else if b["output_format"] != format {
						t.Error("output codec lost")
					}
					if owned {
						refs, ok := b["image"].([]any)
						if !ok || len(refs) != 1 || refs[0] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(source.Bytes()) {
							t.Error("owned source changed")
						}
					} else if b["image"] != nil {
						t.Error("invented image reference")
					}
					w.Header().Set("Content-Type", "application/json")
					if failed.Load() {
						_ = json.NewEncoder(w).Encode(map[string]any{"model": model, "data": []any{map[string]any{"error": map[string]any{"code": "GenerationFailed", "message": "test failure"}}}})
						return
					}
					data := map[string]any{"size": fmt.Sprintf("%dx%d", width, width), "output_format": format}
					if responseFormat == "url" {
						data["url"] = endpoint + "/result"
					} else {
						data["b64_json"] = base64.StdEncoding.EncodeToString(encoded.Bytes())
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"model": model, "data": []any{data}, "usage": map[string]any{"generated_images": 1, "output_tokens": 123, "total_tokens": 123}})
				}))
				defer server.Close()
				endpoint = server.URL
				f := newManagedCloudScenarioTestFixture(t, "volcengine", model, endpoint+"/proxy/api/v3", Config{AllowLoopbackEndpoint: true})
				f.service.jobWorkAuthorizer = newNativeMediaWorkAuthorizer("user-001", "app.seedream", "seedream-subject")
				f.service.requireJobWorkAuthority = true
				bodies, err := runtimeartifact.NewDiskStore(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				f.service.SetRuntimeArtifactStore(bodies)
				intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
				intent.CapabilityContract = "image.generate"
				intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.image.generate.volcengine", DriverId: "nimi.runtime.driver.volcengine", DriverDialect: "provider/media-v1"}
				if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.seedream", intent)); err != nil {
					t.Fatal(err)
				}
				decision := func(op accountservice.LocalAppOperation, cap string) context.Context {
					return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.seedream", RegisteredAppSubject: "seedream-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: cap})
				}
				spec := &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "A blue cup", Size: fmt.Sprintf("%dx%d", width, width), OutputFormat: format, ResponseFormat: responseFormat}
				if owned {
					owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", AppID: "app.seedream", RegisteredAppSubject: "seedream-subject"}
					foreign := *owner
					foreign.RegisteredAppSubject = "other"
					putImageArtifactRecordForTest(t, f.service, "source", owner, "image/png", source.Bytes())
					putImageArtifactRecordForTest(t, f.service, "foreign", &foreign, "image/png", source.Bytes())
					spec.ReferenceImageArtifactId = "source"
				}
				req := &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: spec}}
				submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
				for _, field := range []string{"size", "mask", "seed", "foreign"} {
					if field == "foreign" && !owned {
						continue
					}
					bad := proto.Clone(req).(*runtimev1.SubmitLocalAppScenarioJobRequest)
					s := bad.GetImageGenerate()
					switch field {
					case "size":
						s.Size = "512x512"
					case "mask":
						s.Mask = "https://example.test/mask.png"
					case "seed":
						s.Seed = proto.Int64(0)
					case "foreign":
						s.ReferenceImageArtifactId = "foreign"
					}
					if _, err := f.service.SubmitLocalAppScenarioJob(submit, bad); err == nil || calls.Load() != 0 {
						t.Fatal("invalid input dispatched", field, err)
					}
				}
				for _, failure := range []bool{false, true} {
					failed.Store(failure)
					res, err := f.service.SubmitLocalAppScenarioJob(submit, req)
					if err != nil {
						t.Fatal(err)
					}
					var job *runtimev1.LocalAppScenarioJob
					deadline := time.Now().Add(10 * time.Second)
					for time.Now().Before(deadline) {
						out, err := f.service.GetLocalAppScenarioJob(decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet), &runtimev1.GetLocalAppScenarioJobRequest{JobId: res.Job.JobId})
						if err != nil {
							t.Fatal(err)
						}
						job = out.Job
						if isTerminalScenarioJobStatus(job.Status) {
							break
						}
						time.Sleep(20 * time.Millisecond)
					}
					if failure {
						if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || len(job.Artifacts) != 0 {
							t.Fatal("native item error became success", job)
						}
						continue
					}
					if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.Artifacts) != 1 {
						t.Fatal("missing owned result", job)
					}
					a := job.Artifacts[0]
					if a.MimeType != "image/"+format || a.Width != int32(width) || a.Height != int32(width) || a.SizeBytes != int64(encoded.Len()) || a.Sha256 == "" {
						t.Fatal("actual image facts lost", a)
					}
				}
				wantDownloads := int32(0)
				if responseFormat == "url" {
					wantDownloads = 1
				}
				if calls.Load() != 2 || downloads.Load() != wantDownloads {
					t.Fatal("unexpected generation or fetch count", calls.Load(), downloads.Load())
				}
			})
		}
	}
}
