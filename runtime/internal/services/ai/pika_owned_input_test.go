package ai

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
)

func TestPikaOwnedInputsAreDurableBeforePUTAndCleanedAfterOriginalCompletion(t *testing.T) {
	video := pikaTestVideo(t)
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 512, 512))); err != nil {
		t.Fatal(err)
	}
	wav := append(bytes.Clone(mistralVoiceServiceWAV()[:44]), make([]byte, 24000*2*2)...)
	binary.LittleEndian.PutUint32(wav[4:], uint32(len(wav)-8))
	binary.LittleEndian.PutUint32(wav[40:], uint32(len(wav)-44))
	for _, model := range []string{"pika/pika-2.5/image-to-video", "pika/pika-h3-flex/image-to-video", "pika/pika-h3-flex/reference-to-video"} {
		t.Run(model, func(t *testing.T) {
			var mints, puts, creates, deletes atomic.Int32
			var endpoint string
			var f managedCloudScenarioTestFixture
			var jobID atomic.Value
			payloads := [][]byte{encoded.Bytes()}
			mimes := []string{"image/png"}
			roles := []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME}
			mode := runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME
			if model == "pika/pika-h3-flex/image-to-video" {
				payloads = append(payloads, encoded.Bytes())
				mimes = append(mimes, "image/png")
				roles = append(roles, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME)
				mode = runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST
			}
			if strings.HasSuffix(model, "/reference-to-video") {
				payloads = [][]byte{wav, encoded.Bytes(), video}
				mimes = []string{"audio/wav", "image/png", "video/mp4"}
				roles = []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO}
				mode = runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "PUT" {
					index, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/storage/"))
					if err != nil || index < 0 || index >= len(payloads) {
						t.Error("wrong storage URL")
						w.WriteHeader(400)
						return
					}
					if r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" || r.Header.Get("Content-Type") != mimes[index] || r.ContentLength != int64(len(payloads[index])) || r.Header.Get("X-Amz-Meta-Fixture") != "signed" {
						t.Error("signed storage headers changed or API credential leaked")
					}
					f.service.scenarioJobs.mu.RLock()
					var id string
					for k := range f.service.scenarioJobs.jobs {
						id = k
					}
					f.service.scenarioJobs.mu.RUnlock()
					jobID.Store(id)
					uploads := f.service.scenarioJobs.currentPikaUploads(id)
					if len(uploads) != index+1 || uploads[index].PutComplete || uploads[index].URL != endpoint+"/input/"+strconv.Itoa(index) || f.service.scenarioJobs.dispatchMayHaveOccurred(id) {
						t.Error("PUT preceded private custody or fabricated generation dispatch")
					}
					disk, err := os.ReadFile(f.service.scenarioJobs.durablePath)
					if err != nil || !bytes.Contains(disk, []byte(uploads[index].URL)) {
						t.Error("upload locator was not durable before bytes", err)
					}
					body, err := io.ReadAll(r.Body)
					if err != nil || !bytes.Equal(body, payloads[index]) {
						t.Error("captured source bytes changed")
					}
					puts.Add(1)
					w.WriteHeader(200)
					return
				}
				if r.URL.Path == "/result" {
					if r.Header.Get("Authorization") != "" {
						t.Error("result credential leak")
					}
					w.Header().Set("Content-Type", "video/mp4")
					_, _ = w.Write(video)
					return
				}
				if r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("missing captured API credential")
				}
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.Method == "POST" && r.URL.Path == "/v1/media/uploads":
					index := int(mints.Add(1)) - 1
					var b map[string]any
					if json.NewDecoder(r.Body).Decode(&b) != nil || index >= len(payloads) {
						t.Error("wrong upload count")
						return
					}
					if b["content_type"] != mimes[index] || b["size_bytes"] != float64(len(payloads[index])) {
						t.Error("upload metadata differs from captured bytes")
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"upload_url": endpoint + "/storage/" + strconv.Itoa(index), "url": endpoint + "/input/" + strconv.Itoa(index), "method": "PUT", "headers": map[string]string{"Content-Type": mimes[index], "Content-Length": strconv.Itoa(len(payloads[index])), "X-Amz-Meta-Fixture": "signed"}, "expires_in": 300, "max_bytes": 50_000_000})
				case r.Method == "DELETE" && r.URL.Path == "/v1/media/uploads":
					if creates.Load() != 1 || puts.Load() != int32(len(payloads)) {
						t.Error("storage deleted before original task finished")
					}
					uri := r.URL.Query().Get("url")
					if !strings.HasPrefix(uri, endpoint+"/input/") {
						t.Error("deleted an unowned URL")
					}
					deletes.Add(1)
					w.WriteHeader(204)
				case r.Method == "POST" && r.URL.Path == "/v1/media/"+model:
					creates.Add(1)
					if puts.Load() != int32(len(payloads)) {
						t.Error("generation began before source uploads")
					}
					id := jobID.Load().(string)
					uploads := f.service.scenarioJobs.currentPikaUploads(id)
					for _, u := range uploads {
						if !u.PutComplete {
							t.Error("generation lacks durable PUT completion")
						}
					}
					var b map[string]any
					_ = json.NewDecoder(r.Body).Decode(&b)
					if mode == runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE {
						refs, ok := b["references"].([]any)
						if !ok || len(refs) != 3 {
							t.Error("reference count")
							return
						}
						for i, kind := range []string{"audio", "image", "video"} {
							p := refs[i].(map[string]any)
							if p["type"] != kind || p["url"] != endpoint+"/input/"+strconv.Itoa(i) {
								t.Error("owned references lost order, role or original upload")
							}
						}
					} else {
						if b["image"] != endpoint+"/input/0" {
							t.Error("owned first frame missing")
						}
						if len(payloads) == 2 && b["last_frame_image"] != endpoint+"/input/1" {
							t.Error("owned last frame missing")
						}
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": "queued"})
				case r.Method == "GET" && r.URL.Path == "/v1/media/jobs/original":
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": "completed", "output": map[string]any{"media_type": "video", "video": map[string]any{"url": endpoint + "/result"}}})
				default:
					t.Error("unexpected protocol", r.Method, r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			endpoint = server.URL
			f = newManagedCloudScenarioTestFixture(t, "pika", model, endpoint, Config{AllowLoopbackEndpoint: true})
			f.service.jobWorkAuthorizer = newNativeMediaWorkAuthorizer("user-001", "app.pika-owned", "pika-owned-subject")
			f.service.requireJobWorkAuthority = true
			statePath := filepath.Join(t.TempDir(), "state.json")
			store, err := newScenarioJobStoreForLocalStatePath(statePath)
			if err != nil {
				t.Fatal(err)
			}
			f.service.scenarioJobs = store
			intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
			intent.CapabilityContract = "video.generate"
			intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate.pika", DriverId: "nimi.runtime.driver.pika", DriverDialect: "provider/media-v1"}
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.pika-owned", intent)); err != nil {
				t.Fatal(err)
			}
			decision := func(op accountservice.LocalAppOperation, cap string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.pika-owned", RegisteredAppSubject: "pika-owned-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: cap})
			}
			s := &runtimev1.LocalAppVideoGenerateJobSpec{Mode: mode, Prompt: "A blue cup", Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: proto.Int32(5), Resolution: "1080p"}}
			for i, payload := range payloads {
				asset, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{MimeType: mimes[i], Bytes: payload})
				if err != nil {
					t.Fatal(err)
				}
				s.Content = append(s.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: roles[i], ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: asset.ArtifactId}})
			}
			request := &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: s}}
			foreign := proto.Clone(request).(*runtimev1.SubmitLocalAppScenarioJobRequest)
			foreign.GetVideoGenerate().Content[0].ArtifactRef.ArtifactId = "foreign"
			submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
			if _, err := f.service.SubmitLocalAppScenarioJob(submit, foreign); err == nil || mints.Load() != 0 {
				t.Fatal("foreign source dispatched", err)
			}
			response, err := f.service.SubmitLocalAppScenarioJob(submit, request)
			if err != nil {
				t.Fatal(err)
			}
			id := response.Job.JobId
			var job *runtimev1.LocalAppScenarioJob
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				r, err := f.service.GetLocalAppScenarioJob(decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet), &runtimev1.GetLocalAppScenarioJobRequest{JobId: id})
				if err != nil {
					t.Fatal(err)
				}
				job = r.Job
				if isTerminalScenarioJobStatus(job.GetStatus()) {
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || creates.Load() != 1 || deletes.Load() != int32(len(payloads)) {
				t.Fatal(job, creates.Load(), deletes.Load())
			}
			waitCompletedScenarioJobCleanup(t, f.service, id)
			reopened, err := newScenarioJobStoreForLocalStatePathBeforeStartupPrune(statePath)
			if err != nil {
				t.Fatal(err)
			}
			if len(reopened.currentPikaUploads(id)) != len(payloads) || reopened.currentInputCleanup(id) == nil || reopened.currentInputCleanup(id).State != "deleted" {
				t.Fatal("upload or cleanup ownership lost at restart")
			}
			public, _ := json.Marshal(job)
			if bytes.Contains(public, []byte("/input/")) || bytes.Contains(public, []byte("/storage/")) {
				t.Fatal("private upload capability leaked to App")
			}
		})
	}
}
