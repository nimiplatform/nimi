package ai

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestCapturedFaceSwapRestoresOnlyItsCompleteDriverIdentity(t *testing.T) {
	root := t.TempDir()
	bindings := []capabilitydriver.InvocationExactBinding{}
	detectorSHA := "1111111111111111111111111111111111111111111111111111111111111111"
	recognizerSHA := "2222222222222222222222222222222222222222222222222222222222222222"
	swapperSHA := "3333333333333333333333333333333333333333333333333333333333333333"
	for index, slot := range []string{capabilitydriver.FaceDetectorSlot, capabilitydriver.FaceRecognizerSlot, capabilitydriver.FaceSwapperSlot} {
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{RequirementID: slot, AbsolutePath: filepath.Join(root, slot), VerifiedContentID: "content-" + slot, EntrySHA256: []string{detectorSHA, recognizerSHA, swapperSHA}[index]})
	}
	deps := []capabilitydriver.InvocationExactDependencySource{{DependencyFamily: "python.package-set", ConsumerScope: capabilitydriver.InsightFaceConsumerID, CanonicalRoot: root, SelectedSourceRecordID: "selected", Version: "profile", Hashes: map[string]string{"profile_digest": "profile", "driver_bundle_sha256": "bundle"}}}
	for _, item := range []struct{ implementation, driver, dialect, recipe, backend string }{
		{capabilitydriver.HyperSwapVideoImplementationID, capabilitydriver.HyperSwapDriverID, capabilitydriver.HyperSwapVideoDialect, capabilitydriver.HyperSwapVideoRecipeID, capabilitydriver.FaceSwapBackendHyperSwap},
		{capabilitydriver.InsightFaceVideoImplementationID, capabilitydriver.InsightFaceDriverID, capabilitydriver.InsightFaceVideoDriverDialect, capabilitydriver.InsightFaceVideoRecipeID, capabilitydriver.FaceSwapBackendInsightFace},
	} {
		a := &localResolvedAssembly{CapabilityContract: capabilitydriver.VideoFaceSwapContract, DriverIdentity: localResolvedAssemblyDriverIdentity{ImplementationID: item.implementation, DriverID: item.driver, DriverDialect: item.dialect}}
		p, err := restoredVideoFaceSwapPlanner(a)
		if err != nil {
			t.Fatal(err)
		}
		models, err := p.PlanVideoFaceSwapSession("windows/amd64", item.recipe, []byte("owned fixture"), bindings, deps)
		if err != nil || models.Backend != item.backend {
			t.Fatalf("restored backend=%q err=%v", models.Backend, err)
		}
		for _, field := range []string{"implementation", "driver", "dialect"} {
			bad := *a
			switch field {
			case "implementation":
				bad.DriverIdentity.ImplementationID = "unregistered"
			case "driver":
				bad.DriverIdentity.DriverID = "unregistered"
			case "dialect":
				bad.DriverIdentity.DriverDialect = "unregistered"
			}
			if _, err := restoredVideoFaceSwapPlanner(&bad); err == nil {
				t.Fatalf("changed %s identity was restored", field)
			}
		}
	}
}

func TestImageFaceSwapSpecIsOwnedArtifactOnly(t *testing.T) {
	valid := &runtimev1.ImageFaceSwapScenarioSpec{ReferenceImageArtifactId: "reference-1", TargetImageArtifactId: "target-1"}
	owner, kind, err := validateLocalAppScenarioJobRequest(&runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageFaceSwap{ImageFaceSwap: valid}})
	if err != nil || kind != runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_FACE_SWAP || owner.GetImageFaceSwap().GetTargetImageArtifactId() != "target-1" {
		t.Fatalf("typed artifact input: %v", err)
	}
	valid.TargetImageArtifactId = "changed"
	if owner.GetImageFaceSwap().GetTargetImageArtifactId() != "target-1" {
		t.Fatal("caller mutation changed captured spec")
	}
	for _, invalid := range []*runtimev1.ImageFaceSwapScenarioSpec{nil, {}, {ReferenceImageArtifactId: "reference-1"}, {ReferenceImageArtifactId: "reference-1", TargetImageArtifactId: " bad "}} {
		if err := validateImageFaceSwapSpec(invalid); err == nil {
			t.Fatalf("invalid face replacement input admitted: %v", invalid)
		}
	}
	unknown := protowire.AppendTag(nil, 3, protowire.BytesType)
	unknown = protowire.AppendString(unknown, "caller-model-override")
	valid.ProtoReflect().SetUnknown(unknown)
	if err := validateImageFaceSwapSpec(valid); err == nil {
		t.Fatal("unknown face replacement field admitted")
	}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
		if err := validateScenarioExecutionMode(kind, mode); err == nil {
			t.Fatal("face replacement admitted a non-Job mode")
		}
	}
}

func TestFaceSelectionFailuresHaveStableActionableDetails(t *testing.T) {
	for reason, want := range map[runtimev1.ReasonCode]string{
		runtimev1.ReasonCode_AI_FACE_REFERENCE_MISSING:   "no face was detected in the reference image",
		runtimev1.ReasonCode_AI_FACE_REFERENCE_AMBIGUOUS: "the reference image must contain exactly one face",
		runtimev1.ReasonCode_AI_FACE_TARGET_MISSING:      "no face was detected in the target image",
		runtimev1.ReasonCode_AI_FACE_TARGET_AMBIGUOUS:    "the target image must contain exactly one face",
	} {
		if got := sanitizeScenarioJobReasonDetail(nil, reason); got != want {
			t.Fatalf("%s: %q", reason, got)
		}
	}
}

func TestVideoFaceSwapRequiresPolicyAndJobExecutionMode(t *testing.T) {
	spec := &runtimev1.VideoFaceSwapScenarioSpec{ReferenceImageArtifactId: "reference", TargetVideoArtifactId: "video", NoFacePolicy: runtimev1.FaceSwapNoFacePolicy_FACE_SWAP_NO_FACE_POLICY_PRESERVE_FRAME}
	if err := validateVideoFaceSwapSpec(spec); err != nil {
		t.Fatal(err)
	}
	spec.NoFacePolicy = runtimev1.FaceSwapNoFacePolicy_FACE_SWAP_NO_FACE_POLICY_UNSPECIFIED
	if err := validateVideoFaceSwapSpec(spec); err == nil {
		t.Fatal("missing no-face policy was accepted")
	}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
		if err := validateScenarioExecutionMode(runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_FACE_SWAP, mode); err == nil {
			t.Fatal("video face replacement accepted a synchronous or streaming Job alias")
		}
	}
}

func TestPersistedRetiredHyperSwapV1JobRecoversWithoutBlockingNewJobs(t *testing.T) {
	root := t.TempDir()
	durablePath := filepath.Join(root, "jobs.json")
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, image.NewNRGBA(image.Rect(0, 0, 16, 16))); err != nil {
		t.Fatal(err)
	}
	imgBytes := pngBuf.Bytes()
	now := time.Now().UTC().Truncate(time.Second)
	ts := timestamppb.New(now)

	makeAxes := func() []localResolvedAssemblyModelAxis {
		return []localResolvedAssemblyModelAxis{
			{
				RequirementID:     capabilitydriver.FaceDetectorSlot,
				RequirementRole:   runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
				Presence:          runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
				ModelAssetID:      "asset-detector",
				AbsolutePath:      filepath.Join(root, "det_10g.onnx"),
				VerifiedContentID: "sha256:0000000000000000000000000000000000000000000000000000000000000001",
				EntrySHA256:       "0000000000000000000000000000000000000000000000000000000000000001",
			},
			{
				RequirementID:     capabilitydriver.FaceRecognizerSlot,
				RequirementRole:   runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
				Presence:          runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
				ModelAssetID:      "asset-recognizer",
				AbsolutePath:      filepath.Join(root, "w600k_r50.onnx"),
				VerifiedContentID: "sha256:0000000000000000000000000000000000000000000000000000000000000002",
				EntrySHA256:       "0000000000000000000000000000000000000000000000000000000000000002",
			},
			{
				RequirementID:     capabilitydriver.FaceSwapperSlot,
				RequirementRole:   runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
				Presence:          runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
				ModelAssetID:      "asset-swapper",
				AbsolutePath:      filepath.Join(root, "hyperswap_1a_256.onnx"),
				VerifiedContentID: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
				EntrySHA256:       "1111111111111111111111111111111111111111111111111111111111111111",
			},
		}
	}

	imagePayload, err := protojson.Marshal(&runtimev1.ImageFaceSwapScenarioSpec{ReferenceImageArtifactId: "ref-1", TargetImageArtifactId: "tgt-1"})
	if err != nil {
		t.Fatal(err)
	}
	imageAssembly := &localResolvedAssembly{
		Version:            localResolvedAssemblyVersion,
		LoadoutID:          "loadout-v1-img",
		CapabilityContract: capabilitydriver.ImageFaceSwapContract,
		RecipeID:           capabilitydriver.HyperSwapImageRecipeID,
		RecipeRevision:     "1",
		DriverIdentity: localResolvedAssemblyDriverIdentity{
			ImplementationID: capabilitydriver.HyperSwapImageImplementationID,
			DriverID:         capabilitydriver.HyperSwapDriverID,
			DriverDialect:    "hyperswap/image-face-swap/v1",
		},
		ModelAxes: makeAxes(),
		Request:   localResolvedAssemblyRequest{Kind: capabilitydriver.ImageFaceSwapContract, Payload: json.RawMessage(imagePayload), ReferenceInput: imgBytes, BinaryInput: imgBytes},
		LoadPlan: localResolvedAssemblyLoadPlan{
			Kind: "image-face-swap",
			FaceSwap: &localResolvedAssemblyFaceSwapPlan{
				PlatformTuple: "windows/amd64", ProfileRoot: root, ProfileDigest: "profile", DriverBundleDigest: "bundle",
			},
		},
	}
	videoPayload, err := protojson.Marshal(&runtimev1.VideoFaceSwapScenarioSpec{
		ReferenceImageArtifactId: "ref-1", TargetVideoArtifactId: "vid-1",
		NoFacePolicy: runtimev1.FaceSwapNoFacePolicy_FACE_SWAP_NO_FACE_POLICY_PRESERVE_FRAME,
	})
	if err != nil {
		t.Fatal(err)
	}
	videoAssembly := &localResolvedAssembly{
		Version:            localResolvedAssemblyVersion,
		LoadoutID:          "loadout-v1-vid",
		CapabilityContract: capabilitydriver.VideoFaceSwapContract,
		RecipeID:           capabilitydriver.HyperSwapVideoRecipeID,
		RecipeRevision:     "1",
		DriverIdentity: localResolvedAssemblyDriverIdentity{
			ImplementationID: capabilitydriver.HyperSwapVideoImplementationID,
			DriverID:         capabilitydriver.HyperSwapDriverID,
			DriverDialect:    "hyperswap/video-face-swap/v1",
		},
		ModelAxes: makeAxes(),
		Request:   localResolvedAssemblyRequest{Kind: capabilitydriver.VideoFaceSwapContract, Payload: json.RawMessage(videoPayload), ReferenceInput: imgBytes, BinaryInput: []byte("mp4"), MIMEType: "video/mp4"},
		LoadPlan: localResolvedAssemblyLoadPlan{
			Kind: "video-face-swap",
			FaceSwap: &localResolvedAssemblyFaceSwapPlan{
				PlatformTuple: "windows/amd64", ProfileRoot: root, ProfileDigest: "profile", DriverBundleDigest: "bundle",
			},
		},
	}

	writer := newScenarioJobStore()
	writer.durablePath = durablePath
	for _, entry := range []struct {
		id       string
		scenario runtimev1.ScenarioType
		status   runtimev1.ScenarioJobStatus
		assembly *localResolvedAssembly
	}{
		{"job-v1-img-done", runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_FACE_SWAP, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, imageAssembly},
		{"job-v1-vid-running", runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_FACE_SWAP, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, videoAssembly},
	} {
		identity, err := projectResolvedAssemblyEffectiveInputIdentity(entry.assembly)
		if err != nil {
			t.Fatalf("project legacy v1 identity: %v", err)
		}
		job := &runtimev1.ScenarioJob{
			JobId:                  entry.id,
			ScenarioType:           entry.scenario,
			ExecutionMode:          runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
			Status:                 entry.status,
			RouteDecision:          runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			ReasonCode:             runtimev1.ReasonCode_ACTION_EXECUTED,
			TraceId:                "trace-" + entry.id,
			Head:                   &runtimev1.ScenarioRequestHead{AppId: "nimi.home", SubjectUserId: "user-1"},
			EffectiveInputIdentity: identity,
			CreatedAt:              ts,
			UpdatedAt:              ts,
		}
		rec := &scenarioJobRecord{
			job: job, resolvedAssembly: entry.assembly,
			createdAt: now, updatedAt: now,
			done: make(chan struct{}),
		}
		if entry.status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			rec.terminalAt = now
			rec.doneClosed = true
			close(rec.done)
		}
		writer.jobs[entry.id] = rec
		writer.markDurableJobChangedLocked(entry.id)
	}
	if err := writer.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistCreate}); err != nil {
		t.Fatalf("persist legacy v1 face-swap jobs: %v", err)
	}

	reloaded := newScenarioJobStore()
	reloaded.durablePath = durablePath
	if err := reloaded.loadDurableJobs(false); err != nil {
		t.Fatalf("loadDurableJobs with legacy v1 face-swap records: %v", err)
	}
	if reloaded.recoveryIncomplete {
		t.Fatalf("retired v1 face-swap record triggered recoveryIncomplete: %+v", reloaded.IsolationDiagnostics())
	}
	if err := reloaded.admitNewScenarioAction(); err != nil {
		t.Fatalf("new unrelated scenario job blocked after v1 recovery: %v", err)
	}
	if got, ok := reloaded.get("job-v1-img-done"); !ok || got.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("completed v1 job not preserved: ok=%v job=%+v", ok, got)
	}
	if got, ok := reloaded.get("job-v1-vid-running"); !ok || got.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || got.GetReasonCode() != runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED {
		t.Fatalf("nonterminal v1 job not marked interrupted: ok=%v job=%+v", ok, got)
	}
	// Live execution re-planning must still reject the retired v1 dialect.
	if _, err := faceSwapPlanFromResolvedAssembly(imageAssembly); err == nil {
		t.Fatal("retired v1 image face-swap assembly was re-planned for live execution")
	}
	if _, err := videoFaceSwapPlanFromResolvedAssembly(videoAssembly); err == nil {
		t.Fatal("retired v1 video face-swap assembly was re-planned for live execution")
	}
	// Persisted video assembly validation must still reject corrupt records missing frozen inputs.
	missingRef := *videoAssembly
	missingRef.Request.ReferenceInput = nil
	if err := validatePersistedVideoFaceSwapAssembly(&missingRef); err == nil {
		t.Fatal("persisted video face-swap assembly without ReferenceInput was accepted")
	}
	missingVideo := *videoAssembly
	missingVideo.Request.BinaryInput = nil
	if err := validatePersistedVideoFaceSwapAssembly(&missingVideo); err == nil {
		t.Fatal("persisted video face-swap assembly without BinaryInput was accepted")
	}
}
