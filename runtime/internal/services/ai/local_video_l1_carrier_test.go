package ai

import (
	"context"
	"encoding/base64"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

func TestLocalVideoL1ArtifactReferenceCarrier(t *testing.T) {
	svc := newTestService(nil)
	host := &localVideoHostStub{entered: make(chan struct{})}
	svc.SetLocalExecutionResolver(&countingLocalExecutionResolver{projection: selectedVideoExecutionForTest(t, "l1-carrier")})
	svc.SetLocalVideoExecutionHost(host)
	svc.SetLocalVideoMediaPipeline(&videoMediaPipelineStub{})
	ctx := localVideoIntentContext(scenarioJobUserContext("app.local", "user-l1"))
	imageBytes := l1CarrierPNGBytes(t)
	artifactID := uploadL1CarrierArtifact(t, svc, ctx, "app.local", "user-l1", "image/png", imageBytes)

	submitted, err := svc.SubmitScenarioJob(ctx, localVideoL1Request(artifactID))
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, submitted.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("L1 terminal=%+v", terminal)
	}

	host.mu.Lock()
	if host.calls != 1 || len(host.plans) != 1 {
		host.mu.Unlock()
		t.Fatalf("Host calls=%d plans=%d", host.calls, len(host.plans))
	}
	plan := host.plans[0]
	host.mu.Unlock()
	if plan.ConditioningMode() != capabilitydriver.VideoConditioningModeRef2VAImage {
		t.Fatalf("conditioning mode=%q", plan.ConditioningMode())
	}
	reference, ok := plan.ReferenceImage()
	if !ok || reference.Role != capabilitydriver.VideoInputRoleReferenceImage || reference.SourceIdentity != artifactID || string(reference.ImageBytes) != string(imageBytes) {
		t.Fatalf("resolved reference=%+v present=%v", reference, ok)
	}
}

func TestLocalVideoL1ArtifactReferenceRejectsBeforeJobCreation(t *testing.T) {
	tests := []struct {
		name       string
		prepare    func(*testing.T, *Service) (context.Context, string)
		wantCode   codes.Code
		wantReason runtimev1.ReasonCode
	}{
		{
			name: "unauthorized owner",
			prepare: func(t *testing.T, svc *Service) (context.Context, string) {
				ownerCtx := scenarioJobUserContext("app.local", "user-owner")
				artifactID := uploadL1CarrierArtifact(t, svc, ownerCtx, "app.local", "user-owner", "image/png", l1CarrierPNGBytes(t))
				return localVideoIntentContext(scenarioJobUserContext("app.local", "user-other")), artifactID
			},
			wantCode: codes.PermissionDenied, wantReason: runtimev1.ReasonCode_ARTIFACT_FORBIDDEN,
		},
		{
			name: "non image MIME",
			prepare: func(t *testing.T, svc *Service) (context.Context, string) {
				ctx := localVideoIntentContext(scenarioJobUserContext("app.local", "user-l1"))
				return ctx, uploadL1CarrierArtifact(t, svc, ctx, "app.local", "user-l1", "audio/wav", []byte("RIFFaudio"))
			},
			wantCode: codes.InvalidArgument, wantReason: runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH,
		},
		{
			name: "missing artifact",
			prepare: func(t *testing.T, _ *Service) (context.Context, string) {
				return localVideoIntentContext(scenarioJobUserContext("app.local", "user-l1")), "artifact_missing_l1"
			},
			wantCode: codes.NotFound, wantReason: runtimev1.ReasonCode_ARTIFACT_NOT_FOUND,
		},
		{
			name: "oversized artifact",
			prepare: func(t *testing.T, svc *Service) (context.Context, string) {
				const artifactID = "artifact_oversized_l1"
				payload := make([]byte, runtimeartifact.MaxInlineBytes+1)
				if err := svc.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
					Bytes: payload, MimeType: "image/png", SizeBytes: int64(len(payload)),
					Owner: &runtimeartifact.ArtifactOwner{SubjectUserID: "user-l1", AppID: "app.local"},
				}); err != nil {
					t.Fatalf("store oversized artifact: %v", err)
				}
				return localVideoIntentContext(scenarioJobUserContext("app.local", "user-l1")), artifactID
			},
			wantCode: codes.ResourceExhausted, wantReason: runtimev1.ReasonCode_ARTIFACT_TOO_LARGE,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			host := &localVideoHostStub{}
			svc.SetLocalExecutionResolver(&countingLocalExecutionResolver{projection: selectedVideoExecutionForTest(t, "l1-reject-"+test.name)})
			svc.SetLocalVideoExecutionHost(host)
			svc.SetLocalVideoMediaPipeline(&videoMediaPipelineStub{})
			ctx, artifactID := test.prepare(t, svc)
			_, err := svc.SubmitScenarioJob(ctx, localVideoL1Request(artifactID))
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != test.wantReason || statusCode(err) != test.wantCode {
				t.Fatalf("submit error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
			}
			if host.calls != 0 || len(svc.scenarioJobs.jobs) != 0 {
				t.Fatalf("rejected L1 input dispatched host=%d jobs=%d", host.calls, len(svc.scenarioJobs.jobs))
			}
		})
	}
}

func TestVideoCatalogShapeRecognizesArtifactReferenceImage(t *testing.T) {
	spec := localVideoL1Request("artifact_catalog_l1").GetSpec().GetVideoGenerate()
	roles := videoScenarioInputRoles(spec)
	if !sameStringSet(roles, []string{"prompt", "reference_image"}) || videoReferenceImageCount(spec) != 1 {
		t.Fatalf("catalog roles=%v reference_images=%d", roles, videoReferenceImageCount(spec))
	}
}

func TestCloudVideoArtifactReferenceIsTypedUnsupported(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "volcengine", "doubao-seedance-2-0-260128", "https://ark.cn-beijing.volces.com/api/v3", Config{})
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), capabilitydriver.StableDiffusionVideoCapabilityContract, fixture.targetRef)
	_, err := fixture.service.SubmitScenarioJob(ctx, localVideoL1Request("artifact_cloud_l1"))
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || statusCode(err) != codes.InvalidArgument {
		t.Fatalf("Cloud artifact submit error=%v reason=%v present=%v", err, reason, ok)
	}
	if len(fixture.service.scenarioJobs.jobs) != 0 {
		t.Fatalf("Cloud artifact reference created %d jobs", len(fixture.service.scenarioJobs.jobs))
	}
}

func uploadL1CarrierArtifact(t *testing.T, svc *Service, ctx context.Context, appID, subjectUserID, mimeType string, payload []byte) string {
	t.Helper()
	stream := &mockUploadArtifactStream{
		ctx: ctx,
		reqs: []*runtimev1.UploadArtifactRequest{
			{Payload: &runtimev1.UploadArtifactRequest_Metadata{Metadata: &runtimev1.UploadArtifactMetadata{
				AppId: appID, SubjectUserId: subjectUserID, MimeType: mimeType, DisplayName: "l1-reference",
			}}},
			{Payload: &runtimev1.UploadArtifactRequest_Chunk{Chunk: &runtimev1.UploadArtifactChunk{Sequence: 0, Bytes: payload}}},
		},
	}
	if err := svc.UploadArtifact(stream); err != nil {
		t.Fatalf("UploadArtifact: %v", err)
	}
	artifactID := stream.resp.GetArtifact().GetArtifactId()
	if artifactID == "" {
		t.Fatal("UploadArtifact returned an empty artifact id")
	}
	return artifactID
}

func localVideoL1Request(artifactID string) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
			Prompt: "animate this frame",
			Mode:   runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE,
			Content: []*runtimev1.VideoContentItem{
				{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "animate this frame"},
				{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: artifactID}},
			},
			Options: &runtimev1.VideoGenerationOptions{Resolution: "512x288", Frames: testInt32(22), Fps: testInt32(24), GenerateAudio: testBool(true)},
		}}},
	}
}

func l1CarrierPNGBytes(t *testing.T) []byte {
	t.Helper()
	payload, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatalf("decode PNG fixture: %v", err)
	}
	return payload
}
