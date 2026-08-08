package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"github.com/nimiplatform/nimi/runtime/internal/videomedia"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

type localVideoHostStub struct {
	mu              sync.Mutex
	plans           []*capabilitydriver.VideoInvocationPlan
	calls           int
	entered         chan struct{}
	release         chan struct{}
	cancelObserved  chan struct{}
	allowCancelExit chan struct{}
	progress        []localexecution.VideoExecutionProgress
	candidate       localexecution.RawAVCandidate
	err             error
}

func (h *localVideoHostStub) ExecuteVideo(ctx context.Context, plan *capabilitydriver.VideoInvocationPlan, progress localexecution.VideoProgressFunc) (localexecution.RawAVCandidate, error) {
	h.mu.Lock()
	h.calls++
	h.plans = append(h.plans, plan)
	updates := append([]localexecution.VideoExecutionProgress(nil), h.progress...)
	h.mu.Unlock()
	for _, update := range updates {
		if progress != nil {
			progress(update)
		}
	}
	closeOnce(h.entered)
	if h.release != nil {
		select {
		case <-h.release:
		case <-ctx.Done():
			closeOnce(h.cancelObserved)
			if h.allowCancelExit != nil {
				<-h.allowCancelExit
			}
			return localexecution.RawAVCandidate{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
		}
	}
	if h.err != nil {
		return localexecution.RawAVCandidate{}, h.err
	}
	if len(h.candidate.Frames) > 0 {
		return cloneVideoCandidate(h.candidate), nil
	}
	return validVideoCandidate(plan), nil
}

type videoMediaPipelineStub struct {
	mu            sync.Mutex
	calls         int
	entered       chan struct{}
	release       chan struct{}
	err           error
	omitLastFrame bool
}

func (p *videoMediaPipelineStub) EncodeAndInspect(ctx context.Context, plan *capabilitydriver.VideoInvocationPlan, candidate localexecution.RawAVCandidate) (videomedia.Result, error) {
	p.mu.Lock()
	p.calls++
	p.mu.Unlock()
	closeOnce(p.entered)
	if p.release != nil {
		select {
		case <-p.release:
		case <-ctx.Done():
			return videomedia.Result{}, ctx.Err()
		}
	}
	if p.err != nil {
		return videomedia.Result{}, p.err
	}
	if err := videomedia.ValidateCandidate(plan, candidate); err != nil {
		return videomedia.Result{}, err
	}
	payload := []byte("\x00\x00\x00\x18ftypisom-local-video")
	digest := sha256.Sum256(payload)
	width, height := plan.Size()
	result := videomedia.Result{Bytes: payload, Facts: videomedia.Facts{
		MIMEType: videomedia.MIMETypeMP4, SizeBytes: int64(len(payload)), SHA256: hex.EncodeToString(digest[:]),
		Width: width, Height: height, FPS: plan.FPS(), FrameCount: plan.FrameCount(),
		Duration: time.Duration(float64(plan.FrameCount()) / float64(plan.FPS()) * float64(time.Second)), Channels: 2, SampleRate: 32000,
	}}
	if plan.ReturnLastFrame() && !p.omitLastFrame {
		frame := image.NewNRGBA(image.Rect(0, 0, width, height))
		frame.SetNRGBA(width-1, height-1, color.NRGBA{R: 0x24, G: 0x68, B: 0xac, A: 0xff})
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, frame); err != nil {
			return videomedia.Result{}, err
		}
		frameBytes := encoded.Bytes()
		frameDigest := sha256.Sum256(frameBytes)
		result.LastFrame = &videomedia.StillImage{
			Bytes: append([]byte(nil), frameBytes...), MIMEType: videomedia.MIMETypePNG,
			SizeBytes: int64(len(frameBytes)), SHA256: hex.EncodeToString(frameDigest[:]),
			Width: width, Height: height, FrameIndex: plan.FrameCount() - 1,
		}
	}
	return result, nil
}

type countingLocalExecutionResolver struct {
	mu         sync.Mutex
	projection *localexecution.SelectedLocalExecution
	err        error
	calls      int
}

func (r *countingLocalExecutionResolver) SelectedLocalCapabilityContracts() []string {
	return []string{capabilitydriver.StableDiffusionVideoCapabilityContract}
}

func (r *countingLocalExecutionResolver) ResolveSelectedLocalExecution(string) (*localexecution.SelectedLocalExecution, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls++
	if r.err != nil {
		return nil, r.err
	}
	return cloneSelectedExecutionForTest(r.projection), nil
}

func (r *countingLocalExecutionResolver) set(projection *localexecution.SelectedLocalExecution) {
	r.mu.Lock()
	r.projection = projection
	r.mu.Unlock()
}

type rejectingRuntimeArtifactStore struct {
	*runtimeartifact.MemoryStore
}

func (s *rejectingRuntimeArtifactStore) Put(string, runtimeartifact.ArtifactRecord) error {
	return errors.New("artifact store rejected candidate")
}

type secondPutRejectingRuntimeArtifactStore struct {
	*runtimeartifact.MemoryStore
	puts int
}

func (s *secondPutRejectingRuntimeArtifactStore) Put(artifactID string, record runtimeartifact.ArtifactRecord) error {
	s.puts++
	if s.puts == 2 {
		return errors.New("artifact store rejected second candidate")
	}
	return s.MemoryStore.Put(artifactID, record)
}

func TestNormalizeLocalVideoSpecExplicitZeroAndFalseOverrideDefaults(t *testing.T) {
	defaults, _ := structpb.NewStruct(map[string]any{"options": map[string]any{
		"seed": 19.0, "cameraFixed": true, "watermark": true,
	}})
	got, err := normalizeLocalVideoSpec(&runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{{
			Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
			Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
			Text: "video",
		}},
		Options: &runtimev1.VideoGenerationOptions{
			Seed: testInt64(0), CameraFixed: testBool(false), Watermark: testBool(false),
		},
	}, defaults)
	if err != nil {
		t.Fatalf("normalizeLocalVideoSpec: %v", err)
	}
	options := got.GetOptions()
	if options.Seed == nil || options.CameraFixed == nil || options.Watermark == nil ||
		options.GetSeed() != 0 || options.GetCameraFixed() || options.GetWatermark() {
		t.Fatalf("explicit zero/false values were replaced by defaults: %+v", options)
	}
}

func TestLocalVideoRatioDerivationAndContradictionAreTypedAtAdmission(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&countingLocalExecutionResolver{projection: selectedVideoExecutionForTest(t, "video-ratio")})
	for _, test := range []struct {
		ratio         string
		width, height int
	}{
		{ratio: "16:9", width: 512, height: 288},
		{ratio: "9:16", width: 288, height: 512},
		{ratio: "1:1", width: 384, height: 384},
	} {
		request := localVideoJobRequestForTest(64, 64, 5)
		options := request.GetSpec().GetVideoGenerate().GetOptions()
		options.Resolution, options.Ratio = "", test.ratio
		effective, err := svc.captureLocalVideoEffectiveInputs(localVideoIntentContext(context.Background()), request.GetHead(), request.GetSpec().GetVideoGenerate())
		if err != nil {
			t.Fatalf("ratio %s admission: %v", test.ratio, err)
		}
		width, height := effective.plan.Size()
		if width != test.width || height != test.height {
			t.Fatalf("ratio %s size=%dx%d, want %dx%d", test.ratio, width, height, test.width, test.height)
		}
	}

	request := localVideoJobRequestForTest(512, 512, 5)
	request.GetSpec().GetVideoGenerate().GetOptions().Ratio = "16:9"
	_, err := svc.captureLocalVideoEffectiveInputs(localVideoIntentContext(context.Background()), request.GetHead(), request.GetSpec().GetVideoGenerate())
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("ratio contradiction error=%v reason=%v present=%v", err, reason, ok)
	}
}

func TestLocalVideoHappyPathPreservesProgressSnapshotAndJobCustody(t *testing.T) {
	svc := newTestService(nil)
	first := selectedVideoExecutionForTest(t, "video-first")
	second := selectedVideoExecutionForTest(t, "video-second")
	resolver := &countingLocalExecutionResolver{projection: first}
	host := &localVideoHostStub{
		entered: make(chan struct{}), release: make(chan struct{}),
		progress: []localexecution.VideoExecutionProgress{{Stage: localexecution.VideoExecutionStageGenerating, CurrentStep: 7, TotalSteps: 22, FrameIndex: 7, FrameCount: 22}},
	}
	pipeline := &videoMediaPipelineStub{}
	svc.SetLocalExecutionResolver(resolver)
	svc.SetLocalVideoExecutionHost(host)
	svc.SetLocalVideoMediaPipeline(pipeline)

	principal := protectedprincipal.New(
		"app.local", "desktop-account-product.v1", "desktop-account-product.v1",
		&runtimev1.AccountProjection{AccountId: "account-video", RealmEnvironmentId: "realm-video"},
		1, [32]byte{1}, make(chan struct{}),
	)
	ownerCtx := protectedprincipal.With(context.Background(), principal)
	initialDefaults, _ := structpb.NewStruct(map[string]any{"options": map[string]any{"seed": 19.0}})
	initialIntent := localAppAIConfigIntent(capabilitydriver.StableDiffusionVideoCapabilityContract)
	initialIntent.Defaults = initialDefaults
	if _, err := svc.OverwriteAppAIConfig(ownerCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("app.local", initialIntent)}); err != nil {
		t.Fatalf("OverwriteAppAIConfig(initial): %v", err)
	}
	response, err := svc.SubmitScenarioJob(ownerCtx, localVideoJobRequestForTest(512, 288, 22))
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	jobID := response.GetJob().GetJobId()
	select {
	case <-host.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("video Host was not entered")
	}
	running := waitForLocalVideoJob(t, svc, jobID, func(job *runtimev1.ScenarioJob) bool {
		return job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING && job.GetProgressCurrentStep() == 7
	})
	if running.GetProgressTotalSteps() != 22 || running.GetProgressPercent() != 31 || len(running.GetArtifacts()) != 0 {
		t.Fatalf("generating progress projection = %+v", running)
	}

	resolver.set(second)
	replacementDefaults, _ := structpb.NewStruct(map[string]any{"options": map[string]any{"resolution": "64x64", "frames": 5.0, "seed": 99.0}})
	replacementIntent := localAppAIConfigIntent(capabilitydriver.StableDiffusionVideoCapabilityContract)
	replacementIntent.Defaults = replacementDefaults
	if _, err := svc.OverwriteAppAIConfig(ownerCtx, &runtimev1.OverwriteAppAIConfigRequest{Config: appAIConfig("app.local", replacementIntent)}); err != nil {
		t.Fatalf("OverwriteAppAIConfig(replacement): %v", err)
	}
	close(host.release)
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, jobID)
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || terminal.GetProgressPercent() != 100 || len(terminal.GetArtifacts()) != 1 {
		t.Fatalf("terminal video job = %+v", terminal)
	}
	artifact := terminal.GetArtifacts()[0]
	if artifact.GetMimeType() != videomedia.MIMETypeMP4 || artifact.GetWidth() != 512 || artifact.GetHeight() != 288 || artifact.GetFps() != 24 ||
		artifact.GetChannels() != 2 || artifact.GetSampleRateHz() != 32000 || artifact.GetDurationMs() <= 0 || len(artifact.GetBytes()) == 0 {
		t.Fatalf("video artifact = %+v", artifact)
	}
	if artifact.GetMetadata().GetFields()["frame_count"].GetNumberValue() != 22 || artifact.GetMetadata().GetFields()["producer_job_id"].GetStringValue() != jobID ||
		artifact.GetMetadata().GetFields()["conditioning_mode"].GetStringValue() != string(capabilitydriver.VideoConditioningModeFL2VAT2VA) {
		t.Fatalf("video artifact metadata = %+v", artifact.GetMetadata())
	}
	record, ok := svc.runtimeArtifacts.Get(artifact.GetArtifactId())
	if !ok || record.ProducerJobID != jobID || record.Owner == nil || record.Owner.SubjectUserID != "account-video" || record.Owner.AppID != "app.local" {
		t.Fatalf("video artifact custody = %+v present=%v", record, ok)
	}
	artifactService := runtimeartifact.New(svc.runtimeArtifacts, nil)
	read, err := artifactService.ReadArtifactBytes(ownerCtx, &runtimev1.ReadArtifactBytesRequest{ArtifactId: artifact.GetArtifactId()})
	if err != nil || string(read.GetBytes()) != string(artifact.GetBytes()) {
		t.Fatalf("owner read = %+v error=%v", read, err)
	}
	host.mu.Lock()
	captured := host.plans[0]
	host.mu.Unlock()
	width, height := captured.Size()
	if captured.ConfigurationID() != first.ConfigurationID || captured.ConfigurationID() == second.ConfigurationID || width != 512 || height != 288 ||
		captured.FrameCount() != 22 || captured.FPS() != 24 || captured.Seed() != 19 || resolver.calls != 1 {
		t.Fatalf("immutable capture = config=%q size=%dx%d frames=%d fps=%d seed=%d resolves=%d", captured.ConfigurationID(), width, height, captured.FrameCount(), captured.FPS(), captured.Seed(), resolver.calls)
	}
}

func TestLocalVideoDurationReachesPlanAndArtifactMetadata(t *testing.T) {
	svc := newTestService(nil)
	host := &localVideoHostStub{}
	svc.SetLocalExecutionResolver(&countingLocalExecutionResolver{projection: selectedVideoExecutionForTest(t, "video-duration")})
	svc.SetLocalVideoExecutionHost(host)
	svc.SetLocalVideoMediaPipeline(&videoMediaPipelineStub{})
	request := localVideoJobRequestForTest(64, 64, 5)
	options := request.GetSpec().GetVideoGenerate().GetOptions()
	options.Frames = nil
	options.DurationSec = testInt32(2)
	response, err := svc.SubmitScenarioJob(localVideoIntentContext(scenarioJobUserContext("app.local", "user-duration")), request)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(terminal.GetArtifacts()) != 1 {
		t.Fatalf("duration terminal = %+v", terminal)
	}
	host.mu.Lock()
	plan := host.plans[0]
	host.mu.Unlock()
	if plan.FrameCount() != 56 || terminal.GetArtifacts()[0].GetMetadata().GetFields()["frame_count"].GetNumberValue() != 56 {
		t.Fatalf("duration frame propagation: plan=%d metadata=%+v", plan.FrameCount(), terminal.GetArtifacts()[0].GetMetadata())
	}
}

func TestLocalVideoReturnLastFramePublishesReadableJobBoundPNG(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&countingLocalExecutionResolver{projection: selectedVideoExecutionForTest(t, "video-last-frame")})
	svc.SetLocalVideoExecutionHost(&localVideoHostStub{})
	svc.SetLocalVideoMediaPipeline(&videoMediaPipelineStub{})
	request := localVideoJobRequestForTest(64, 64, 5)
	request.GetSpec().GetVideoGenerate().GetOptions().ReturnLastFrame = testBool(true)
	ctx := localVideoIntentContext(scenarioJobUserContext("app.local", "user-last-frame"))
	response, err := svc.SubmitScenarioJob(ctx, request)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(terminal.GetArtifacts()) != 2 {
		t.Fatalf("last-frame terminal = %+v", terminal)
	}
	main, lastFrame := terminal.GetArtifacts()[0], terminal.GetArtifacts()[1]
	if main.GetMimeType() != videomedia.MIMETypeMP4 || lastFrame.GetMimeType() != videomedia.MIMETypePNG ||
		lastFrame.GetWidth() != 64 || lastFrame.GetHeight() != 64 || len(lastFrame.GetBytes()) == 0 {
		t.Fatalf("last-frame artifacts = main=%+v last=%+v", main, lastFrame)
	}
	config, err := png.DecodeConfig(bytes.NewReader(lastFrame.GetBytes()))
	if err != nil || config.Width != 64 || config.Height != 64 {
		t.Fatalf("decode last-frame PNG: config=%+v error=%v", config, err)
	}
	metadata := lastFrame.GetMetadata().GetFields()
	if metadata["artifact_role"].GetStringValue() != "last_frame" || metadata["frame_index"].GetNumberValue() != 4 ||
		metadata["producer_job_id"].GetStringValue() != terminal.GetJobId() || metadata["artifact_custody"].GetStringValue() != "runtime" {
		t.Fatalf("last-frame metadata = %+v", lastFrame.GetMetadata())
	}
	for _, artifact := range terminal.GetArtifacts() {
		record, ok := svc.runtimeArtifacts.Get(artifact.GetArtifactId())
		if !ok || record.ProducerJobID != terminal.GetJobId() || record.Owner == nil || record.Owner.SubjectUserID != "user-last-frame" || record.Owner.AppID != "app.local" {
			t.Fatalf("job-bound artifact %q = %+v present=%v", artifact.GetArtifactId(), record, ok)
		}
	}
}

func TestLocalVideoMissingRequestedLastFrameFailsWithoutPartialArtifact(t *testing.T) {
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&countingLocalExecutionResolver{projection: selectedVideoExecutionForTest(t, "video-last-frame-missing")})
	svc.SetLocalVideoExecutionHost(&localVideoHostStub{})
	svc.SetLocalVideoMediaPipeline(&videoMediaPipelineStub{omitLastFrame: true})
	request := localVideoJobRequestForTest(64, 64, 5)
	request.GetSpec().GetVideoGenerate().GetOptions().ReturnLastFrame = testBool(true)
	response, err := svc.SubmitScenarioJob(localVideoIntentContext(context.Background()), request)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || len(terminal.GetArtifacts()) != 0 || svc.runtimeArtifacts.Len() != 0 {
		t.Fatalf("missing last-frame terminal=%+v stored=%d", terminal, svc.runtimeArtifacts.Len())
	}
}

func TestLocalVideoAdmissionRejectsBeforeJobOrHostDispatch(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*runtimev1.SubmitScenarioJobRequest, *localexecution.SelectedLocalExecution)
		reason runtimev1.ReasonCode
	}{
		{name: "shape", mutate: func(req *runtimev1.SubmitScenarioJobRequest, _ *localexecution.SelectedLocalExecution) {
			req.Spec.GetVideoGenerate().Options.Resolution = "510x288"
		}, reason: runtimev1.ReasonCode_AI_INPUT_INVALID},
		{name: "fps", mutate: func(req *runtimev1.SubmitScenarioJobRequest, _ *localexecution.SelectedLocalExecution) {
			req.Spec.GetVideoGenerate().Options.Fps = testInt32(23)
		}, reason: runtimev1.ReasonCode_AI_INPUT_INVALID},
		{name: "frame grid", mutate: func(req *runtimev1.SubmitScenarioJobRequest, _ *localexecution.SelectedLocalExecution) {
			req.Spec.GetVideoGenerate().Options.Frames = testInt32(21)
		}, reason: runtimev1.ReasonCode_AI_INPUT_INVALID},
		{name: "audio required", mutate: func(req *runtimev1.SubmitScenarioJobRequest, _ *localexecution.SelectedLocalExecution) {
			req.Spec.GetVideoGenerate().Options.GenerateAudio = testBool(false)
		}, reason: runtimev1.ReasonCode_AI_INPUT_INVALID},
		{name: "camera fixed", mutate: func(req *runtimev1.SubmitScenarioJobRequest, _ *localexecution.SelectedLocalExecution) {
			req.Spec.GetVideoGenerate().Options.CameraFixed = testBool(true)
		}, reason: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "watermark", mutate: func(req *runtimev1.SubmitScenarioJobRequest, _ *localexecution.SelectedLocalExecution) {
			req.Spec.GetVideoGenerate().Options.Watermark = testBool(true)
		}, reason: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "draft", mutate: func(req *runtimev1.SubmitScenarioJobRequest, _ *localexecution.SelectedLocalExecution) {
			req.Spec.GetVideoGenerate().Options.Draft = testBool(true)
		}, reason: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "service tier", mutate: func(req *runtimev1.SubmitScenarioJobRequest, _ *localexecution.SelectedLocalExecution) {
			req.Spec.GetVideoGenerate().Options.ServiceTier = "priority"
		}, reason: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "execution expiry", mutate: func(req *runtimev1.SubmitScenarioJobRequest, _ *localexecution.SelectedLocalExecution) {
			req.Spec.GetVideoGenerate().Options.ExecutionExpiresAfterSec = 60
		}, reason: runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED},
		{name: "missing slot", mutate: func(_ *runtimev1.SubmitScenarioJobRequest, selected *localexecution.SelectedLocalExecution) {
			selected.ExactBindings = selected.ExactBindings[:len(selected.ExactBindings)-1]
		}, reason: runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED},
		{name: "multiple images", mutate: func(req *runtimev1.SubmitScenarioJobRequest, _ *localexecution.SelectedLocalExecution) {
			spec := req.Spec.GetVideoGenerate()
			spec.Mode = runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE
			spec.Content = append(spec.Content,
				&runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, ImageUrl: &runtimev1.VideoContentImageURL{Url: "artifact-a"}},
				&runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, ImageUrl: &runtimev1.VideoContentImageURL{Url: "artifact-b"}},
			)
		}, reason: runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED},
		{name: "video reference", mutate: func(req *runtimev1.SubmitScenarioJobRequest, _ *localexecution.SelectedLocalExecution) {
			req.Spec.GetVideoGenerate().Content = append(req.Spec.GetVideoGenerate().Content,
				&runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO, VideoUrl: &runtimev1.VideoContentVideoURL{Url: "artifact-video"}})
		}, reason: runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			selected := selectedVideoExecutionForTest(t, "reject-"+test.name)
			req := localVideoJobRequestForTest(64, 64, 5)
			test.mutate(req, selected)
			host := &localVideoHostStub{}
			pipeline := &videoMediaPipelineStub{}
			svc.SetLocalExecutionResolver(&countingLocalExecutionResolver{projection: selected})
			svc.SetLocalVideoExecutionHost(host)
			svc.SetLocalVideoMediaPipeline(pipeline)
			_, err := svc.SubmitScenarioJob(localVideoIntentContext(context.Background()), req)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != test.reason {
				t.Fatalf("submit error=%v reason=%v ok=%v", err, reason, ok)
			}
			host.mu.Lock()
			hostCalls := host.calls
			host.mu.Unlock()
			if hostCalls != 0 || pipeline.calls != 0 || len(svc.scenarioJobs.jobs) != 0 {
				t.Fatalf("pre-dispatch reject created work: host=%d media=%d jobs=%d", hostCalls, pipeline.calls, len(svc.scenarioJobs.jobs))
			}
		})
	}
}

func TestLocalVideoSelectionFailureDoesNotFallbackOrResolveTwice(t *testing.T) {
	svc := newTestService(nil)
	resolver := &countingLocalExecutionResolver{err: grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)}
	host := &localVideoHostStub{}
	pipeline := &videoMediaPipelineStub{}
	svc.SetLocalExecutionResolver(resolver)
	svc.SetLocalVideoExecutionHost(host)
	svc.SetLocalVideoMediaPipeline(pipeline)
	_, err := svc.SubmitScenarioJob(localVideoIntentContext(context.Background()), localVideoJobRequestForTest(64, 64, 5))
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND {
		t.Fatalf("selection failure=%v reason=%v ok=%v", err, reason, ok)
	}
	if resolver.calls != 1 || host.calls != 0 || pipeline.calls != 0 || len(svc.scenarioJobs.jobs) != 0 {
		t.Fatalf("selection failure work: resolves=%d host=%d media=%d jobs=%d", resolver.calls, host.calls, pipeline.calls, len(svc.scenarioJobs.jobs))
	}
}

func TestLocalVideoSubmitFailsClosedWhenHostOrMediaIsUnavailable(t *testing.T) {
	tests := []struct {
		name string
		wire func(*Service)
	}{
		{name: "host", wire: func(svc *Service) { svc.SetLocalVideoMediaPipeline(&videoMediaPipelineStub{}) }},
		{name: "media", wire: func(svc *Service) { svc.SetLocalVideoExecutionHost(&localVideoHostStub{}) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			svc.SetLocalExecutionResolver(&countingLocalExecutionResolver{projection: selectedVideoExecutionForTest(t, "unavailable-"+test.name)})
			test.wire(svc)
			_, err := svc.SubmitScenarioJob(localVideoIntentContext(context.Background()), localVideoJobRequestForTest(64, 64, 5))
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED || statusCode(err) != codes.Unavailable {
				t.Fatalf("unavailable submit=%v reason=%v ok=%v", err, reason, ok)
			}
			if len(svc.scenarioJobs.jobs) != 0 {
				t.Fatalf("unavailable submit created %d jobs", len(svc.scenarioJobs.jobs))
			}
		})
	}
}

func TestLocalVideoMediaAndCustodyFailuresNeverPublishCandidate(t *testing.T) {
	tests := []struct {
		name            string
		pipeline        *videoMediaPipelineStub
		store           runtimeartifact.Store
		returnLastFrame bool
	}{
		{name: "media", pipeline: &videoMediaPipelineStub{err: &videomedia.Error{Kind: videomedia.FailureEncode, Op: "stub encode", Err: errors.New("boom")}}},
		{name: "custody", pipeline: &videoMediaPipelineStub{}, store: &rejectingRuntimeArtifactStore{MemoryStore: runtimeartifact.NewMemoryStore()}},
		{
			name: "last frame batch custody", pipeline: &videoMediaPipelineStub{}, returnLastFrame: true,
			store: &secondPutRejectingRuntimeArtifactStore{MemoryStore: runtimeartifact.NewMemoryStore()},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			if test.store != nil {
				svc.SetRuntimeArtifactStore(test.store)
			}
			svc.SetLocalExecutionResolver(&countingLocalExecutionResolver{projection: selectedVideoExecutionForTest(t, "failure-"+test.name)})
			svc.SetLocalVideoExecutionHost(&localVideoHostStub{})
			svc.SetLocalVideoMediaPipeline(test.pipeline)
			request := localVideoJobRequestForTest(64, 64, 5)
			if test.returnLastFrame {
				request.GetSpec().GetVideoGenerate().GetOptions().ReturnLastFrame = testBool(true)
			}
			response, err := svc.SubmitScenarioJob(localVideoIntentContext(context.Background()), request)
			if err != nil {
				t.Fatalf("SubmitScenarioJob: %v", err)
			}
			terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
			if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || terminal.GetReasonCode() != runtimev1.ReasonCode_AI_OUTPUT_INVALID || len(terminal.GetArtifacts()) != 0 {
				t.Fatalf("failure terminal = %+v", terminal)
			}
			if svc.runtimeArtifacts.Len() != 0 {
				t.Fatalf("failure retained %d readable candidates", svc.runtimeArtifacts.Len())
			}
			artifactCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "app.local"))
			artifacts, err := svc.GetScenarioArtifacts(artifactCtx, &runtimev1.GetScenarioArtifactsRequest{JobId: terminal.GetJobId()})
			if err != nil || len(artifacts.GetArtifacts()) != 0 {
				t.Fatalf("failure artifact read = %+v error=%v", artifacts, err)
			}
		})
	}
}

func TestLocalVideoCancelWaitsForHostExitAndPublishesNoArtifact(t *testing.T) {
	svc := newTestService(nil)
	host := &localVideoHostStub{entered: make(chan struct{}), release: make(chan struct{}), cancelObserved: make(chan struct{}), allowCancelExit: make(chan struct{})}
	pipeline := &videoMediaPipelineStub{}
	svc.SetLocalExecutionResolver(&countingLocalExecutionResolver{projection: selectedVideoExecutionForTest(t, "video-cancel")})
	svc.SetLocalVideoExecutionHost(host)
	svc.SetLocalVideoMediaPipeline(pipeline)
	response, err := svc.SubmitScenarioJob(localVideoIntentContext(context.Background()), localVideoJobRequestForTest(64, 64, 5))
	if err != nil {
		t.Fatal(err)
	}
	<-host.entered
	cancelCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "app.local"))
	canceled, err := svc.CancelScenarioJob(cancelCtx, &runtimev1.CancelScenarioJobRequest{JobId: response.GetJob().GetJobId(), Reason: "stop video"})
	if err != nil {
		t.Fatalf("CancelScenarioJob: %v", err)
	}
	if canceled.GetJob().GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("cancel became terminal before Host exit: %+v", canceled)
	}
	select {
	case <-host.cancelObserved:
	case <-time.After(2 * time.Second):
		t.Fatal("Host did not observe cancellation")
	}
	if current, _ := svc.scenarioJobs.get(response.GetJob().GetJobId()); current.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("job became CANCELED before Host exit: %+v", current)
	}
	close(host.allowCancelExit)
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, svc, response.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || len(terminal.GetArtifacts()) != 0 || svc.runtimeArtifacts.Len() != 0 || pipeline.calls != 0 {
		t.Fatalf("cancel terminal = %+v media_calls=%d stored=%d", terminal, pipeline.calls, svc.runtimeArtifacts.Len())
	}
}

func selectedVideoExecutionForTest(t *testing.T, configurationID string) *localexecution.SelectedLocalExecution {
	t.Helper()
	driver := capabilitydriver.StableDiffusionVideoDriver{}
	requirements, reason := driver.Interpret(capabilitydriver.InterpretInput{})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("Interpret: %v", reason)
	}
	root := t.TempDir()
	bindings := make([]localexecution.ExactBinding, 0, len(requirements))
	for index, requirement := range requirements {
		payload := []byte(configurationID + requirement.GetRequirementId())
		path := filepath.Join(root, fmt.Sprintf("model-%d.bin", index))
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		digestBytes := sha256.Sum256(payload)
		digest := hex.EncodeToString(digestBytes[:])
		bindings = append(bindings, localexecution.ExactBinding{
			RequirementID: requirement.GetRequirementId(), LocalAssetID: fmt.Sprintf("asset-%d", index), AbsolutePath: path,
			VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
		})
	}
	return &localexecution.SelectedLocalExecution{
		ConfigurationID: configurationID, CapabilityContract: capabilitydriver.StableDiffusionVideoCapabilityContract, DisplayName: configurationID,
		DriverIdentity: (&capabilitydriver.Identity{
			ImplementationID: capabilitydriver.StableDiffusionVideoImplementationID,
			DriverID:         capabilitydriver.StableDiffusionVideoDriverID, DriverDialect: capabilitydriver.StableDiffusionVideoDriverDialect,
		}).Proto(),
		Requirements: requirements, ExactBindings: bindings, SupportedFeatures: []string{"input.image"}, Configured: true,
	}
}

func localVideoIntentContext(parent context.Context) context.Context {
	return executionintent.WithIntent(parent, executionintent.Intent{
		CapabilityContract: capabilitydriver.StableDiffusionVideoCapabilityContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
}

func localVideoJobRequestForTest(width int, height int, frames int32) *runtimev1.SubmitScenarioJobRequest {
	prompt := "a copper robot walking through rain"
	return &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "app.local"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
			Prompt: prompt, Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
			Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: prompt}},
			Options: &runtimev1.VideoGenerationOptions{Resolution: fmt.Sprintf("%dx%d", width, height), Frames: testInt32(frames), Fps: testInt32(24), GenerateAudio: testBool(true)},
		}}},
	}
}

func validVideoCandidate(plan *capabilitydriver.VideoInvocationPlan) localexecution.RawAVCandidate {
	width, height := plan.Size()
	frames := make([]localexecution.RawVideoFrame, plan.FrameCount())
	for index := range frames {
		frames[index] = localexecution.RawVideoFrame{RGBBytes: make([]byte, width*height*3), Width: width, Height: height}
	}
	samplesPerChannel := int(math.Round(float64(plan.FrameCount()) / float64(plan.FPS()) * 32000))
	return localexecution.RawAVCandidate{
		Frames: frames, FrameCount: plan.FrameCount(), FPS: plan.FPS(), ComputeMS: 42,
		Audio: localexecution.RawAudio{PCMSamples: make([]float32, samplesPerChannel*2), Channels: 2, SampleRate: 32000},
	}
}

func cloneVideoCandidate(value localexecution.RawAVCandidate) localexecution.RawAVCandidate {
	out := value
	out.Frames = make([]localexecution.RawVideoFrame, len(value.Frames))
	for index, frame := range value.Frames {
		out.Frames[index] = frame
		out.Frames[index].RGBBytes = append([]byte(nil), frame.RGBBytes...)
	}
	out.Audio.PCMSamples = append([]float32(nil), value.Audio.PCMSamples...)
	return out
}

func waitForLocalVideoJob(t *testing.T, svc *Service, jobID string, predicate func(*runtimev1.ScenarioJob) bool) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if job, ok := svc.scenarioJobs.get(jobID); ok && predicate(job) {
			return job
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("video job %s did not reach expected state", jobID)
	return nil
}

func statusCode(err error) codes.Code {
	return status.Code(err)
}
