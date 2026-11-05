package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
)

func TestGeminiOmniCleanupFollowsCompleteOwnedBodiesAndPreservesResultOnFailure(t *testing.T) {
	for _, test := range []struct {
		name             string
		failFile, cancel bool
	}{{name: "deleted"}, {name: "file deletion failed", failFile: true}, {name: "canceled original resources", cancel: true}} {
		t.Run(test.name, func(t *testing.T) {
			var creates, deletes atomic.Int32
			var owned atomic.Bool
			uri := "https://generativelanguage.googleapis.com/v1beta/files/video123:download?alt=media"
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.Method + " " + r.URL.Path {
				case "POST /interactions":
					creates.Add(1)
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "v1_original", "object": "interaction", "status": "completed", "model": capabilitydriver.GeminiOmniVideoModel,
						"steps": []any{map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "video", "mime_type": "video/mp4", "uri": uri}}}}})
				case "GET /files/video123":
					_ = json.NewEncoder(w).Encode(map[string]any{"name": "files/video123", "state": "PROCESSING"})
				case "DELETE /files/video123", "DELETE /interactions/v1_original":
					if !owned.Load() && !test.cancel {
						t.Error("resource cleanup preceded complete local custody")
					}
					deletes.Add(1)
					if test.failFile && r.URL.Path == "/files/video123" {
						w.WriteHeader(500)
						return
					}
					w.WriteHeader(200)
				default:
					t.Errorf("unexpected IO %s %s", r.Method, r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "gemini", capabilitydriver.GeminiOmniVideoModel, server.URL, Config{AllowLoopbackEndpoint: true})
			bodies := runtimeartifact.NewMemoryStore()
			f.service.SetRuntimeArtifactStore(bodies)
			owner := scenarioJobUserContext("nimi.desktop", "user-001")
			head := &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}
			submitted, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "video.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{
				Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
				Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "A toy boat.", Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(3), Resolution: "720p"}}}},
			})
			if err != nil {
				t.Fatal(err)
			}
			id := submitted.GetJob().GetJobId()
			deadline := time.Now().Add(3 * time.Second)
			for f.service.scenarioJobs.originalNativeReceipt(id) == nil {
				if time.Now().After(deadline) {
					job, _ := f.service.scenarioJobs.get(id)
					t.Fatalf("original receipt missing: %v, creates=%d", job, creates.Load())
				}
				time.Sleep(time.Millisecond)
			}
			waitScenarioJobWorkExit(t, f.service.scenarioJobs, id)
			receipt := f.service.scenarioJobs.originalNativeReceipt(id)
			if receipt == nil || receipt.GeminiInteractionID != "v1_original" {
				t.Fatalf("original receipt=%v", receipt)
			}
			if _, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id}); err != nil {
				t.Fatal(err)
			}
			if deletes.Load() != 0 {
				t.Fatal("pending file was deleted")
			}
			if test.cancel {
				canceled, err := f.service.CancelScenarioJob(owner, &runtimev1.CancelScenarioJobRequest{JobId: id, Reason: "test cancellation"})
				if err != nil || canceled.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || canceled.GetJob().GetStopOutcome() != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNCONFIRMED || deletes.Load() != 2 || creates.Load() != 1 {
					t.Fatalf("cancellation cleanup claimed a false model stop or skipped resources: %v %v deletes=%d", canceled, err, deletes.Load())
				}
				return
			}
			// Model a recovered transfer whose complete original body is already in
			// Runtime custody. This tests cleanup ordering and publication, not codecs.
			artifact := proto.Clone(receipt.Artifact).(*runtimev1.ScenarioArtifact)
			artifact.Uri = uri
			observation := &nimillm.NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{artifact}}
			artifactOwner := f.service.runtimeArtifactOwnerForJob(id, head)
			if err := bodies.PrepareJobBodies(id, artifactOwner, []runtimeartifact.JobBodySlot{{ArtifactID: artifact.ArtifactId, MaxBytes: runtimeartifact.MaxCustodyBytes}}); err != nil {
				t.Fatal(err)
			}
			payload := []byte("original-owned-video")
			if err := bodies.StageJobBody(context.Background(), artifact.ArtifactId, runtimeartifact.ArtifactRecord{ProducerJobID: id, Owner: artifactOwner, MimeType: "video/mp4", SizeBytes: int64(len(payload))}, io.NopCloser(bytes.NewReader(payload))); err != nil {
				t.Fatal(err)
			}
			if err := f.service.scenarioJobs.stageNativeResult(context.Background(), id, observation); err != nil {
				t.Fatal(err)
			}
			owned.Store(true)
			done := waitScenarioJobTerminal(t, f.service, id, 10*time.Second)
			if done.Status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(done.Artifacts) != 1 || creates.Load() != 1 || deletes.Load() != 2 {
				t.Fatalf("cleanup publication: %v creates=%d deletes=%d", done, creates.Load(), deletes.Load())
			}
			fields := done.Artifacts[0].GetMetadata().GetFields()
			want := "deleted"
			if test.failFile {
				want = "failed"
			}
			if fields["provider_file_cleanup"].GetStringValue() != want || fields["provider_interaction_cleanup"].GetStringValue() != "deleted" {
				t.Fatalf("cleanup result missing: %v", fields)
			}
			waitCompletedScenarioJobCleanup(t, f.service, id)
		})
	}
}
