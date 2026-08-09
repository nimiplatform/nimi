package ai

import (
	"bytes"
	"context"
	"io"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

type custodyCountingSource struct {
	io.Reader
	closes atomic.Int32
}

func (source *custodyCountingSource) Close() error {
	source.closes.Add(1)
	return nil
}

func createLocalAppCustodyJob(t *testing.T, svc *Service, jobID string, subject string) *runtimev1.ScenarioRequestHead {
	t.Helper()
	head := &runtimev1.ScenarioRequestHead{AppId: "producer-app", SubjectUserId: "account-1"}
	if created := svc.scenarioJobs.createOwned(&runtimev1.ScenarioJob{
		JobId: jobID, Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
	}, nil, &localAppJobOwner{AccountID: "account-1", RegisteredAppSubject: subject, ProducerAppID: "producer-app"}); created == nil {
		t.Fatal("create Local App custody job")
	}
	return head
}

func TestRuntimeJobCustodyAcceptsBoundedBytesAndIncrementalStream(t *testing.T) {
	tests := []struct {
		name string
		body func(t *testing.T, payload []byte) (*capabilitydriver.ArtifactBody, *custodyCountingSource)
	}{
		{name: "bounded bytes", body: func(t *testing.T, payload []byte) (*capabilitydriver.ArtifactBody, *custodyCountingSource) {
			body, err := capabilitydriver.NewBoundedArtifactBody(payload)
			if err != nil {
				t.Fatal(err)
			}
			return body, nil
		}},
		{name: "incremental stream", body: func(t *testing.T, payload []byte) (*capabilitydriver.ArtifactBody, *custodyCountingSource) {
			source := &custodyCountingSource{Reader: bytes.NewReader(payload)}
			body, err := capabilitydriver.NewIncrementalArtifactBody(source)
			if err != nil {
				t.Fatal(err)
			}
			return body, source
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			head := createLocalAppCustodyJob(t, svc, "job-"+test.name, "subject-1")
			payload := []byte("streamed-video-payload")
			body, source := test.body(t, payload)
			artifact := &runtimev1.ScenarioArtifact{ArtifactId: "artifact-" + test.name, MimeType: "video/mp4", SizeBytes: int64(len(payload))}
			created, err := svc.storeRuntimeJobArtifacts(context.Background(), "job-"+test.name, head,
				[]*runtimev1.ScenarioArtifact{artifact}, map[string]*capabilitydriver.ArtifactBody{artifact.GetArtifactId(): body})
			if err != nil || len(created) != 1 {
				t.Fatalf("store body: created=%v err=%v", created, err)
			}
			if source != nil && source.closes.Load() != 1 {
				t.Fatalf("stream closes=%d, want one", source.closes.Load())
			}
			if len(artifact.GetBytes()) != 0 || artifact.GetSizeBytes() != int64(len(payload)) || artifact.GetSha256() == "" {
				t.Fatalf("metadata-only artifact=%+v", artifact)
			}
			record, ok := svc.runtimeArtifacts.Get(artifact.GetArtifactId())
			if !ok || !bytes.Equal(record.Bytes, payload) || record.Owner == nil || record.Owner.RegisteredAppSubject != "subject-1" {
				t.Fatalf("committed record=%+v present=%v", record, ok)
			}
		})
	}
}

func TestCommittedCustodyReferenceValidatesAndSurvivesAttachFailure(t *testing.T) {
	svc := newTestService(nil)
	head := createLocalAppCustodyJob(t, svc, "job-ref", "subject-1")
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "account-1", RegisteredAppSubject: "subject-1", AppID: "producer-app"}
	if err := svc.runtimeArtifacts.Put("artifact-existing", runtimeartifact.ArtifactRecord{Bytes: []byte("existing"), MimeType: "video/mp4", Owner: owner}); err != nil {
		t.Fatal(err)
	}
	reference, err := svc.issueRuntimeCustodyReference("artifact-existing", runtimeCustodyOperationScenarioOutputAttach, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	body, err := capabilitydriver.NewCommittedArtifactBody(reference)
	if err != nil {
		t.Fatal(err)
	}
	attached, err := svc.storeAndAttachRuntimeJobArtifactBody(context.Background(), "job-ref", head,
		&runtimev1.ScenarioArtifact{ArtifactId: "artifact-existing", MimeType: "video/mp4"}, body,
		func(*runtimev1.ScenarioArtifact) bool { return true })
	if err != nil || attached.GetSizeBytes() != int64(len("existing")) || attached.GetSha256() == "" || len(attached.GetBytes()) != 0 {
		t.Fatalf("committed reference attach=%+v err=%v", attached, err)
	}
	body, err = capabilitydriver.NewCommittedArtifactBody(reference)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.storeAndAttachRuntimeJobArtifactBody(context.Background(), "job-ref", head,
		&runtimev1.ScenarioArtifact{ArtifactId: "artifact-existing", MimeType: "video/mp4"}, body,
		func(*runtimev1.ScenarioArtifact) bool { return false })
	if err == nil {
		t.Fatal("committed reference attach failure returned success")
	}
	if record, ok := svc.runtimeArtifacts.Get("artifact-existing"); !ok || string(record.Bytes) != "existing" {
		t.Fatalf("pre-existing reference was deleted: %+v present=%v", record, ok)
	}
}

func TestCommittedCustodyReferenceRejectsOwnerOperationIntegrityAndExpiryChanges(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(t *testing.T, svc *Service, reference **capabilitydriver.RuntimeCustodyReference)
	}{
		{name: "foreign issuer", mutate: func(t *testing.T, svc *Service, reference **capabilitydriver.RuntimeCustodyReference) {
			record, ok := svc.runtimeArtifacts.Stat("artifact-existing")
			if !ok {
				t.Fatal("stat existing artifact")
			}
			issuer := capabilitydriver.NewRuntimeCustodyIssuer()
			issued, err := issuer.Issue(capabilitydriver.RuntimeCustodyDescriptor{
				ArtifactID: "artifact-existing", AccountID: record.Owner.SubjectUserID,
				RegisteredAppSubject: record.Owner.RegisteredAppSubject, ProducerAppID: record.Owner.AppID,
				SizeBytes: record.SizeBytes, ContentSHA256: record.ContentSHA256, MIMEType: record.MimeType,
				EligibleOperation: runtimeCustodyOperationScenarioOutputAttach, ExpiresAt: time.Now().Add(time.Minute),
			})
			if err != nil {
				t.Fatal(err)
			}
			*reference = issued
		}},
		{name: "owner", mutate: func(t *testing.T, svc *Service, _ **capabilitydriver.RuntimeCustodyReference) {
			createLocalAppCustodyJob(t, svc, "job-ref", "subject-2")
		}},
		{name: "operation", mutate: func(t *testing.T, svc *Service, reference **capabilitydriver.RuntimeCustodyReference) {
			issued, err := svc.issueRuntimeCustodyReference("artifact-existing", "different_operation", time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			*reference = issued
		}},
		{name: "integrity", mutate: func(t *testing.T, svc *Service, _ **capabilitydriver.RuntimeCustodyReference) {
			if err := svc.runtimeArtifacts.Delete("artifact-existing"); err != nil {
				t.Fatal(err)
			}
			if err := svc.runtimeArtifacts.Put("artifact-existing", runtimeartifact.ArtifactRecord{
				Bytes: []byte("changed"), MimeType: "video/mp4",
				Owner: &runtimeartifact.ArtifactOwner{SubjectUserID: "account-1", RegisteredAppSubject: "subject-1", AppID: "producer-app"},
			}); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "expiry", mutate: func(t *testing.T, svc *Service, reference **capabilitydriver.RuntimeCustodyReference) {
			issued, err := svc.issueRuntimeCustodyReference("artifact-existing", runtimeCustodyOperationScenarioOutputAttach, time.Millisecond)
			if err != nil {
				t.Fatal(err)
			}
			*reference = issued
			time.Sleep(5 * time.Millisecond)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			head := createLocalAppCustodyJob(t, svc, "job-ref", "subject-1")
			if err := svc.runtimeArtifacts.Put("artifact-existing", runtimeartifact.ArtifactRecord{
				Bytes: []byte("existing"), MimeType: "video/mp4",
				Owner: &runtimeartifact.ArtifactOwner{SubjectUserID: "account-1", RegisteredAppSubject: "subject-1", AppID: "producer-app"},
			}); err != nil {
				t.Fatal(err)
			}
			reference, err := svc.issueRuntimeCustodyReference("artifact-existing", runtimeCustodyOperationScenarioOutputAttach, time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			test.mutate(t, svc, &reference)
			body, _ := capabilitydriver.NewCommittedArtifactBody(reference)
			created, err := svc.storeRuntimeJobArtifact(context.Background(), "job-ref", head,
				&runtimev1.ScenarioArtifact{ArtifactId: "artifact-existing", MimeType: "video/mp4"}, body)
			if err == nil || created {
				t.Fatalf("invalid committed reference created=%v err=%v", created, err)
			}
		})
	}
}

func TestTranscriptionTextIsCapturedFromCommittedCustodyIntoJobState(t *testing.T) {
	svc := newTestService(nil)
	head := &runtimev1.ScenarioRequestHead{AppId: "producer-app", SubjectUserId: "account-1"}
	svc.scenarioJobs.createOwned(&runtimev1.ScenarioJob{
		JobId: "job-transcription", Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
	}, nil, &localAppJobOwner{AccountID: "account-1", RegisteredAppSubject: "subject-1", ProducerAppID: "producer-app"})
	payload := []byte("hello from committed custody")
	body, _ := capabilitydriver.NewBoundedArtifactBody(payload)
	artifact := &runtimev1.ScenarioArtifact{ArtifactId: "artifact-transcription", MimeType: "text/plain; charset=utf-8", SizeBytes: int64(len(payload))}
	if _, err := svc.storeRuntimeJobArtifacts(context.Background(), "job-transcription", head,
		[]*runtimev1.ScenarioArtifact{artifact}, map[string]*capabilitydriver.ArtifactBody{artifact.GetArtifactId(): body}); err != nil {
		t.Fatal(err)
	}
	text, err := svc.captureScenarioTranscriptionText(context.Background(), runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, []*runtimev1.ScenarioArtifact{artifact})
	if err != nil || text != string(payload) {
		t.Fatalf("capture text=%q err=%v", text, err)
	}
	job, ok := svc.scenarioJobs.transition("job-transcription", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
			job.Artifacts = []*runtimev1.ScenarioArtifact{artifact}
			job.TranscriptionText = text
		})
	if !ok {
		t.Fatal("complete transcription job")
	}
	if err := svc.runtimeArtifacts.Delete("artifact-transcription"); err != nil {
		t.Fatal(err)
	}
	projected, err := projectLocalAppScenarioJob(job)
	if err != nil || projected.GetTranscriptionText() != string(payload) {
		t.Fatalf("immutable transcription projection=%+v err=%v", projected, err)
	}
}
