package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type fakeImageInvocationSubstrate struct {
	mu             sync.Mutex
	healthy        bool
	ensureCalls    int
	generateOrder  []string
	generatedSeeds []int64
	active         int
	maxActive      int
	stopCalls      int
	ensureFn       func(context.Context, *capabilitydriver.ImageInvocationPlan, func() error, localexecution.ImageProgressFunc) (bool, error)
	generateFn     func(context.Context, *capabilitydriver.ImageInvocationPlan, int32, int64) (localexecution.ImageArtifact, error)
}

func (f *fakeImageInvocationSubstrate) Ensure(ctx context.Context, plan *capabilitydriver.ImageInvocationPlan, validate func() error, progress localexecution.ImageProgressFunc) (bool, error) {
	f.mu.Lock()
	f.ensureCalls++
	f.mu.Unlock()
	if f.ensureFn != nil {
		return f.ensureFn(ctx, plan, validate, progress)
	}
	if err := validate(); err != nil {
		return false, err
	}
	if progress != nil {
		progress(localexecution.ImageExecutionProgress{Stage: localexecution.ImageExecutionStageLoading, ArtifactCount: int32(plan.ImageCount())})
	}
	return false, nil
}

func (f *fakeImageInvocationSubstrate) GenerateImage(ctx context.Context, plan *capabilitydriver.ImageInvocationPlan, index int32, seed int64, _ localexecution.ImageProgressFunc) (localexecution.ImageArtifact, error) {
	f.mu.Lock()
	f.generateOrder = append(f.generateOrder, fmt.Sprintf("%s:%d", plan.RequestPlan().Prompt(), index))
	f.generatedSeeds = append(f.generatedSeeds, seed)
	f.active++
	if f.active > f.maxActive {
		f.maxActive = f.active
	}
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		f.active--
		f.mu.Unlock()
	}()
	if f.generateFn != nil {
		return f.generateFn(ctx, plan, index, seed)
	}
	return localexecution.ImageArtifact{Index: index, Seed: seed, Bytes: testPNGBytes(), MediaType: "image/png"}, nil
}

func (f *fakeImageInvocationSubstrate) Healthy() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.healthy
}

func (f *fakeImageInvocationSubstrate) Stop() error {
	f.mu.Lock()
	f.stopCalls++
	f.healthy = false
	f.mu.Unlock()
	return nil
}

func TestImageExecutionHostStrictFIFOAndQueuedCancellation(t *testing.T) {
	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	var firstOnce sync.Once
	substrate := &fakeImageInvocationSubstrate{healthy: true}
	substrate.generateFn = func(ctx context.Context, plan *capabilitydriver.ImageInvocationPlan, index int32, seed int64) (localexecution.ImageArtifact, error) {
		if plan.RequestPlan().Prompt() == "first" {
			firstOnce.Do(func() { close(firstStarted) })
			select {
			case <-releaseFirst:
			case <-ctx.Done():
				return localexecution.ImageArtifact{}, ctx.Err()
			}
		}
		return localexecution.ImageArtifact{Index: index, Seed: seed, Bytes: testPNGBytes(), MediaType: "image/png"}, nil
	}
	host := newImageExecutionHostWithSubstrate(substrate, nil)
	defer func() { _ = host.Stop() }()

	firstDone := make(chan error, 1)
	go func() {
		_, err := host.ExecuteImage(context.Background(), imagePlanForHostTest(t, "first", 1), nil, nil, nil)
		firstDone <- err
	}()
	select {
	case <-firstStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("first request did not acquire the image lease")
	}

	secondCtx, cancelSecond := context.WithCancel(context.Background())
	secondProgress := make(chan localexecution.ImageExecutionProgress, 1)
	secondHostStarted := make(chan struct{})
	secondDone := make(chan error, 1)
	go func() {
		_, err := host.ExecuteImage(secondCtx, imagePlanForHostTest(t, "second", 1), func() error {
			close(secondHostStarted)
			return nil
		}, nil, func(value localexecution.ImageExecutionProgress) {
			secondProgress <- value
		})
		secondDone <- err
	}()
	waitForImageHostQueueLength(t, host, 1)
	select {
	case <-secondHostStarted:
		t.Fatal("queued image received factual start before FIFO dequeue")
	default:
	}
	thirdHostStarted := make(chan struct{})
	thirdDone := make(chan error, 1)
	go func() {
		_, err := host.ExecuteImage(context.Background(), imagePlanForHostTest(t, "third", 1), func() error {
			close(thirdHostStarted)
			return nil
		}, nil, nil)
		thirdDone <- err
	}()
	waitForImageHostQueueLength(t, host, 2)
	cancelSecond()
	select {
	case err := <-secondDone:
		if localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
			t.Fatalf("queued cancel error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("queued cancellation was not honored")
	}
	select {
	case progress := <-secondProgress:
		t.Fatalf("queued request emitted Host work progress: %+v", progress)
	default:
	}
	select {
	case <-secondHostStarted:
		t.Fatal("canceled queued image received factual Host start")
	default:
	}
	close(releaseFirst)
	if err := <-firstDone; err != nil {
		t.Fatalf("first ExecuteImage: %v", err)
	}
	if err := <-thirdDone; err != nil {
		t.Fatalf("third ExecuteImage: %v", err)
	}
	select {
	case <-thirdHostStarted:
	default:
		t.Fatal("third image did not receive factual start after FIFO dequeue")
	}

	substrate.mu.Lock()
	order := append([]string(nil), substrate.generateOrder...)
	maxActive := substrate.maxActive
	substrate.mu.Unlock()
	if !reflect.DeepEqual(order, []string{"first:1", "third:1"}) {
		t.Fatalf("generation order = %#v", order)
	}
	if maxActive != 1 {
		t.Fatalf("maximum concurrent image generations = %d", maxActive)
	}
}

func TestImageExecutionHostStopCancelsActiveAndQueuedRequests(t *testing.T) {
	started := make(chan struct{})
	var once sync.Once
	substrate := &fakeImageInvocationSubstrate{healthy: true}
	substrate.generateFn = func(ctx context.Context, _ *capabilitydriver.ImageInvocationPlan, _ int32, _ int64) (localexecution.ImageArtifact, error) {
		once.Do(func() { close(started) })
		<-ctx.Done()
		return localexecution.ImageArtifact{}, ctx.Err()
	}
	host := newImageExecutionHostWithSubstrate(substrate, nil)
	activeDone := make(chan error, 1)
	go func() {
		_, err := host.ExecuteImage(context.Background(), imagePlanForHostTest(t, "active-stop", 1), nil, nil, nil)
		activeDone <- err
	}()
	<-started
	queuedDone := make(chan error, 1)
	go func() {
		_, err := host.ExecuteImage(context.Background(), imagePlanForHostTest(t, "queued-stop", 1), nil, nil, nil)
		queuedDone <- err
	}()
	waitForImageHostQueueLength(t, host, 1)
	if err := host.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	for label, done := range map[string]<-chan error{"active": activeDone, "queued": queuedDone} {
		select {
		case err := <-done:
			if localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
				t.Fatalf("%s stop error = %v", label, err)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("%s request did not stop", label)
		}
	}
}

func TestImageExecutionHostRunningCancellationStopsSubstrate(t *testing.T) {
	started := make(chan struct{})
	var once sync.Once
	substrate := &fakeImageInvocationSubstrate{healthy: true}
	substrate.generateFn = func(ctx context.Context, _ *capabilitydriver.ImageInvocationPlan, _ int32, _ int64) (localexecution.ImageArtifact, error) {
		once.Do(func() { close(started) })
		<-ctx.Done()
		return localexecution.ImageArtifact{}, ctx.Err()
	}
	host := newImageExecutionHostWithSubstrate(substrate, nil)
	defer func() { _ = host.Stop() }()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := host.ExecuteImage(ctx, imagePlanForHostTest(t, "cancel", 1), nil, nil, nil)
		done <- err
	}()
	<-started
	cancel()
	if err := <-done; localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
		t.Fatalf("running cancel error = %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		substrate.mu.Lock()
		stops := substrate.stopCalls
		substrate.mu.Unlock()
		if stops > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("running cancellation did not stop the attributed substrate")
}

func TestImageExecutionHostRehashesEveryModelFileBeforeLoad(t *testing.T) {
	plan := imagePlanForHostTest(t, "mismatch", 1)
	files := plan.ModelFiles()
	if err := os.WriteFile(files[1].AbsolutePath, []byte("drifted"), 0o600); err != nil {
		t.Fatal(err)
	}
	substrate := &fakeImageInvocationSubstrate{healthy: true}
	host := newImageExecutionHostWithSubstrate(substrate, nil)
	defer func() { _ = host.Stop() }()
	_, err := host.ExecuteImage(context.Background(), plan, nil, nil, nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureContentMismatch {
		t.Fatalf("content mismatch error = %v", err)
	}
	substrate.mu.Lock()
	generations := len(substrate.generateOrder)
	substrate.mu.Unlock()
	if generations != 0 {
		t.Fatalf("content mismatch reached inference %d times", generations)
	}
}

func TestImageExecutionHostAttributesProcessCrashAndRecoversOnNextRequest(t *testing.T) {
	crashed := false
	substrate := &fakeImageInvocationSubstrate{healthy: true}
	substrate.ensureFn = func(_ context.Context, plan *capabilitydriver.ImageInvocationPlan, validate func() error, progress localexecution.ImageProgressFunc) (bool, error) {
		if err := validate(); err != nil {
			return false, err
		}
		substrate.mu.Lock()
		substrate.healthy = true
		substrate.mu.Unlock()
		if progress != nil {
			progress(localexecution.ImageExecutionProgress{Stage: localexecution.ImageExecutionStageLoading, ArtifactCount: int32(plan.ImageCount())})
		}
		return false, nil
	}
	substrate.generateFn = func(_ context.Context, plan *capabilitydriver.ImageInvocationPlan, index int32, seed int64) (localexecution.ImageArtifact, error) {
		if plan.RequestPlan().Prompt() == "crash" && !crashed {
			crashed = true
			substrate.mu.Lock()
			substrate.healthy = false
			substrate.mu.Unlock()
			return localexecution.ImageArtifact{}, errors.New("process exited")
		}
		return localexecution.ImageArtifact{Index: index, Seed: seed, Bytes: testPNGBytes(), MediaType: "image/png"}, nil
	}
	host := newImageExecutionHostWithSubstrate(substrate, nil)
	defer func() { _ = host.Stop() }()
	if _, err := host.ExecuteImage(context.Background(), imagePlanForHostTest(t, "crash", 1), nil, nil, nil); localexecution.FailureKindOf(err) != localexecution.FailureProcessCrash {
		t.Fatalf("process crash error = %v", err)
	}
	result, err := host.ExecuteImage(context.Background(), imagePlanForHostTest(t, "recover", 1), nil, nil, nil)
	if err != nil || len(result.Artifacts) != 1 {
		t.Fatalf("post-crash local recovery = %+v error=%v", result, err)
	}
}

func TestImageExecutionHostClassifiesExplicitOOM(t *testing.T) {
	substrate := &fakeImageInvocationSubstrate{healthy: true}
	substrate.generateFn = func(_ context.Context, _ *capabilitydriver.ImageInvocationPlan, _ int32, _ int64) (localexecution.ImageArtifact, error) {
		return localexecution.ImageArtifact{}, errors.New("backend failed: out of memory")
	}
	host := newImageExecutionHostWithSubstrate(substrate, nil)
	defer func() { _ = host.Stop() }()
	if _, err := host.ExecuteImage(context.Background(), imagePlanForHostTest(t, "oom", 1), nil, nil, nil); localexecution.FailureKindOf(err) != localexecution.FailureOutOfMemory {
		t.Fatalf("image OOM error = %v (%s)", err, localexecution.FailureKindOf(err))
	}
}

func TestImageExecutionHostPreservesProducedArtifactsOnInferenceFailure(t *testing.T) {
	substrate := &fakeImageInvocationSubstrate{healthy: true}
	substrate.generateFn = func(_ context.Context, _ *capabilitydriver.ImageInvocationPlan, index int32, seed int64) (localexecution.ImageArtifact, error) {
		if index == 2 {
			return localexecution.ImageArtifact{}, errors.New("sampler failed")
		}
		return localexecution.ImageArtifact{Index: index, Seed: seed, Bytes: testPNGBytes(), MediaType: "image/png"}, nil
	}
	host := newImageExecutionHostWithSubstrate(substrate, nil)
	defer func() { _ = host.Stop() }()
	var committed []int32
	result, err := host.ExecuteImage(context.Background(), imagePlanForHostTest(t, "partial", 2), nil, func(artifact localexecution.ImageArtifact) error {
		committed = append(committed, artifact.Index)
		return nil
	}, nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureInference {
		t.Fatalf("partial inference error = %v", err)
	}
	if !reflect.DeepEqual(committed, []int32{1}) || len(result.Artifacts) != 1 || result.Artifacts[0].Index != 1 {
		t.Fatalf("partial result = %+v committed=%v", result, committed)
	}
}

func TestImageExecutionHostProducesExactRequestedArtifactCountInOrder(t *testing.T) {
	substrate := &fakeImageInvocationSubstrate{healthy: true}
	host := newImageExecutionHostWithSubstrate(substrate, nil)
	defer func() { _ = host.Stop() }()
	var committed []int32
	result, err := host.ExecuteImage(context.Background(), imagePlanForHostTest(t, "batch", 3), nil, func(artifact localexecution.ImageArtifact) error {
		committed = append(committed, artifact.Index)
		return nil
	}, nil)
	if err != nil {
		t.Fatalf("ExecuteImage: %v", err)
	}
	if !reflect.DeepEqual(committed, []int32{1, 2, 3}) || len(result.Artifacts) != 3 {
		t.Fatalf("batch result=%+v committed=%v", result, committed)
	}
	for index, artifact := range result.Artifacts {
		if artifact.Index != int32(index+1) || artifact.Seed != int64(7+index) {
			t.Fatalf("artifact order=%+v", result.Artifacts)
		}
	}
	substrate.mu.Lock()
	generatedSeeds := append([]int64(nil), substrate.generatedSeeds...)
	substrate.mu.Unlock()
	if !reflect.DeepEqual(generatedSeeds, []int64{7, 8, 9}) {
		t.Fatalf("batch seeds = %v, want [7 8 9]", generatedSeeds)
	}
}

func TestImageExecutionHostResolvesRandomBatchSeedBeforeDispatch(t *testing.T) {
	substrate := &fakeImageInvocationSubstrate{healthy: true}
	host := newImageExecutionHostWithSubstrate(substrate, nil)
	defer func() { _ = host.Stop() }()
	result, err := host.ExecuteImage(context.Background(), imagePlanForHostTestWithSeed(t, "random-batch", 3, -1), nil, nil, nil)
	if err != nil {
		t.Fatalf("ExecuteImage: %v", err)
	}
	if len(result.Artifacts) != 3 {
		t.Fatalf("random batch artifacts = %+v", result.Artifacts)
	}
	base := result.Artifacts[0].Seed
	if base < 0 || base > math.MaxInt32-2 {
		t.Fatalf("resolved random base seed = %d", base)
	}
	for index, artifact := range result.Artifacts {
		if artifact.Seed != base+int64(index) {
			t.Fatalf("resolved random batch seeds = %+v", result.Artifacts)
		}
	}
}

func TestImageGenerateRequestPreservesSignedInt32Seed(t *testing.T) {
	for _, seed := range []int64{0, -2, math.MinInt32, math.MaxInt32} {
		plan := imagePlanForHostTestWithSeed(t, "seed", 1, seed)
		request, err := imageGenerateRequest("127.0.0.1:43210", managedimagebackend.ProtocolManagedWrapper, plan, seed)
		if err != nil {
			t.Fatalf("imageGenerateRequest(seed=%d): %v", seed, err)
		}
		if request.Seed != int32(seed) {
			t.Fatalf("imageGenerateRequest(seed=%d) projected %d", seed, request.Seed)
		}
	}
	plan := imagePlanForHostTestWithSeed(t, "random-seed", 1, -1)
	if _, err := imageGenerateRequest("127.0.0.1:43210", managedimagebackend.ProtocolManagedWrapper, plan, -1); err == nil {
		t.Fatal("unresolved seed -1 reached native request")
	}
}

func TestImageInvocationTransportUsesCanonicalDriverComponentsAndPrompt(t *testing.T) {
	plan := imagePlanWithUncondForHostTest(t)
	request, err := imageLoadRequest("127.0.0.1:43210", plan, managedimagebackend.ProtocolManagedWrapper)
	if err != nil {
		t.Fatal(err)
	}
	if len(request.Components) != 3 || request.Components[0].OccurrenceID != "text-encoder" ||
		request.Components[0].ComponentKind != "auxiliary" ||
		request.Components[1].OccurrenceID != "vae" ||
		request.Components[2].OccurrenceID != "uncond-diffusion" ||
		request.Components[2].EngineSlot != "uncond_diffusion_model" {
		t.Fatalf("canonical component transport = %+v", request.Components)
	}
	generate, err := imageGenerateRequest("127.0.0.1:43210", managedimagebackend.ProtocolManagedWrapper, plan, plan.RequestPlan().Seed())
	if err != nil {
		t.Fatal(err)
	}
	if got := generate.PositivePrompt; got != plan.RequestPlan().Prompt() {
		t.Fatalf("image prompt = %q, want %q", got, plan.RequestPlan().Prompt())
	}
}

func TestQwenInstructionEditTransportUsesThreeSlotRecipeAndReferenceCarrier(t *testing.T) {
	root := t.TempDir()
	requirementIDs := []string{
		capabilitydriver.StableDiffusionMainRequirementID,
		capabilitydriver.StableDiffusionTextEncoderRequirementID,
		capabilitydriver.StableDiffusionVAERequirementID,
	}
	bindings := make([]capabilitydriver.InvocationExactBinding, 0, len(requirementIDs))
	for index, requirementID := range requirementIDs {
		path := filepath.Join(root, fmt.Sprintf("qwen-component-%d.bin", index))
		payload := []byte(requirementID)
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		digestBytes := sha256.Sum256(payload)
		digest := hex.EncodeToString(digestBytes[:])
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{
			RequirementID: requirementID, ModelAssetID: fmt.Sprintf("qwen-asset-%d", index), AbsolutePath: path,
			VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
		})
	}
	sourceBytes := testPNGBytes()
	portable, err := structpb.NewStruct(map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	plan, err := (capabilitydriver.StableDiffusionImageDriver{}).PlanImageInvocation(capabilitydriver.ImageInvocationInput{
		RecipeID:          capabilitydriver.StableDiffusionQwenImageEditRecipeID,
		PortableConfig:    portable,
		SupportedFeatures: []string{"input.image"},
		ExactBindings:     bindings,
		Request:           &runtimev1.ImageGenerateScenarioSpec{Prompt: "make it dusk"},
		Inputs: []capabilitydriver.ImageResolvedInput{{
			Role:           capabilitydriver.ImageResolvedInputRoleSource,
			SourceIdentity: "artifact_qwen_edit_source", ImageBytes: sourceBytes,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	loadRequest, err := imageLoadRequest("127.0.0.1:43210", plan, managedimagebackend.ProtocolManagedWrapper)
	if err != nil {
		t.Fatal(err)
	}
	if len(loadRequest.Components) != 2 ||
		loadRequest.Components[0].Role != "text_encoder" || loadRequest.Components[0].ComponentKind != "auxiliary" ||
		loadRequest.Components[0].EngineSlot != "llm_path" ||
		loadRequest.Components[1].Role != "vae" || loadRequest.Components[1].ComponentKind != "vae" ||
		loadRequest.Components[1].EngineSlot != "vae_path" ||
		!loadRequest.QwenImageZeroCondT || loadRequest.FlowShift != 3 {
		t.Fatalf("Qwen edit load transport = %+v", loadRequest)
	}
	generateRequest, err := imageGenerateRequest("127.0.0.1:43210", managedimagebackend.ProtocolManagedWrapper, plan, plan.RequestPlan().Seed())
	if err != nil {
		t.Fatal(err)
	}
	if generateRequest.Mode != managedimagebackend.ImageRequestModeInstructionEdit || generateRequest.Src != "" || generateRequest.Mask != "" ||
		!reflect.DeepEqual(generateRequest.ReferenceImage, sourceBytes) {
		t.Fatalf("Qwen edit generate transport = %+v", generateRequest)
	}
}

func TestImageInvocationLoadOptionsUsesCanonicalUncondComponentToken(t *testing.T) {
	plan := imagePlanWithUncondForHostTest(t)
	request, err := imageLoadRequest("127.0.0.1:43210", plan, managedimagebackend.ProtocolDirectGOSD)
	if err != nil {
		t.Fatal(err)
	}
	joinedOptions := strings.Join(request.DirectOptions, "\n")
	load := plan.LoadPlan().(capabilitydriver.StableDiffusionCPPLoadPlan)
	uncond, ok := load.UncondDiffusion()
	if !ok {
		t.Fatal("unconditional diffusion component missing")
	}
	wanted := "uncond_diffusion_model:" + uncond.AbsolutePath()
	if !strings.Contains(joinedOptions, wanted) || strings.Contains(joinedOptions, "high_noise_diffusion_model_path:") {
		t.Fatalf("unconditional diffusion options = %q, want canonical %q only", joinedOptions, wanted)
	}
}

func TestImageExecutionEngineConfigUsesExplicitSDLibraryAndLoopbackAddress(t *testing.T) {
	directory := t.TempDir()
	executable := filepath.Join(directory, "stablediffusion-ggml")
	library := filepath.Join(directory, "selected-gosd.so")
	if err := os.WriteFile(executable, []byte("binary"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(library, []byte("library"), 0o600); err != nil {
		t.Fatal(err)
	}
	firstAddress, err := reserveImageExecutionAddress()
	if err != nil {
		t.Fatal(err)
	}
	secondAddress, err := reserveImageExecutionAddress()
	if err != nil {
		t.Fatal(err)
	}
	if firstAddress == "127.0.0.1:50052" || secondAddress == "127.0.0.1:50052" ||
		!strings.HasPrefix(firstAddress, "127.0.0.1:") || !strings.HasPrefix(secondAddress, "127.0.0.1:") {
		t.Fatalf("addresses were not ephemeral and private: %q %q", firstAddress, secondAddress)
	}
	config, err := imageExecutionEngineConfigFromDirectory(directory, firstAddress, ImageExecutionHostConfig{LibraryPath: library})
	if err != nil {
		t.Fatal(err)
	}
	resolvedExecutable, _ := filepath.EvalSymlinks(executable)
	resolvedLibrary, _ := filepath.EvalSymlinks(library)
	if config.Kind != engineImageExecutionHost || config.Address != firstAddress || config.CommandEnv["SD_LIBRARY"] != resolvedLibrary ||
		!reflect.DeepEqual(config.CommandArgs, []string{"--addr", firstAddress}) || config.BinaryPath != resolvedExecutable {
		t.Fatalf("image engine config = %+v", config)
	}
}

func TestImageExecutionEngineConfigRejectsAmbientOrEscapingPackageContent(t *testing.T) {
	directory := t.TempDir()
	executable := filepath.Join(directory, "stablediffusion-ggml")
	if err := os.WriteFile(executable, []byte("binary"), 0o700); err != nil {
		t.Fatal(err)
	}
	candidate := imageExecutionLibraryCandidates()[0]
	packageLibrary := filepath.Join(directory, candidate)
	if err := os.MkdirAll(filepath.Dir(packageLibrary), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(packageLibrary, []byte("package-library"), 0o600); err != nil {
		t.Fatal(err)
	}
	externalRoot := t.TempDir()
	externalLibrary := filepath.Join(externalRoot, "ambient-library")
	externalExecutable := filepath.Join(externalRoot, "ambient-executable")
	if err := os.WriteFile(externalLibrary, []byte("ambient"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(externalExecutable, []byte("ambient"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SD_LIBRARY", externalLibrary)
	address, err := reserveImageExecutionAddress()
	if err != nil {
		t.Fatal(err)
	}
	config, err := imageExecutionEngineConfigFromDirectory(directory, address, ImageExecutionHostConfig{})
	if err != nil {
		t.Fatal(err)
	}
	resolvedPackageLibrary, _ := filepath.EvalSymlinks(packageLibrary)
	if config.CommandEnv["SD_LIBRARY"] != resolvedPackageLibrary {
		t.Fatalf("ambient SD_LIBRARY replaced package library: %q", config.CommandEnv["SD_LIBRARY"])
	}
	if _, err := imageExecutionEngineConfigFromDirectory(directory, address, ImageExecutionHostConfig{LibraryPath: externalLibrary}); err == nil || !strings.Contains(err.Error(), "admitted package root") {
		t.Fatalf("external library error = %v", err)
	}
	if _, err := imageExecutionEngineConfigFromDirectory(directory, address, ImageExecutionHostConfig{ExecutablePath: externalExecutable}); err == nil || !strings.Contains(err.Error(), "admitted package root") {
		t.Fatalf("external executable error = %v", err)
	}
}

func imagePlanForHostTest(t *testing.T, prompt string, count int32) *capabilitydriver.ImageInvocationPlan {
	return imagePlanForHostTestWithSeed(t, prompt, count, 7)
}

func imagePlanForHostTestWithSeed(t *testing.T, prompt string, count int32, seed int64) *capabilitydriver.ImageInvocationPlan {
	t.Helper()
	root := t.TempDir()
	bindings := make([]capabilitydriver.InvocationExactBinding, 0, 3)
	for index, requirementID := range []string{
		capabilitydriver.StableDiffusionMainRequirementID,
		capabilitydriver.StableDiffusionTextEncoderRequirementID,
		capabilitydriver.StableDiffusionVAERequirementID,
	} {
		path := filepath.Join(root, fmt.Sprintf("model-%d.bin", index))
		payload := []byte(fmt.Sprintf("model-content-%d", index))
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		digestBytes := sha256.Sum256(payload)
		digest := hex.EncodeToString(digestBytes[:])
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{
			RequirementID: requirementID, ModelAssetID: fmt.Sprintf("asset-%d", index), AbsolutePath: path,
			VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
		})
	}
	portable, err := structpb.NewStruct(map[string]any{
		"executionOptions": map[string]any{
			"steps": 2, "cfgScale": 1, "width": 64, "height": 64, "seed": seed, "threads": 1,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	plan, err := (capabilitydriver.StableDiffusionImageDriver{}).PlanImageInvocation(capabilitydriver.ImageInvocationInput{
		RecipeID:       "z-image",
		PortableConfig: portable,
		ExactBindings:  bindings,
		Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: prompt, N: proto.Int32(count), Size: "64x64", Seed: proto.Int64(seed)},
	})
	if err != nil {
		t.Fatalf("PlanImageInvocation: %v", err)
	}
	return plan
}

func imagePlanWithUncondForHostTest(t *testing.T) *capabilitydriver.ImageInvocationPlan {
	t.Helper()
	root := t.TempDir()
	requirementIDs := []string{
		capabilitydriver.StableDiffusionMainRequirementID,
		capabilitydriver.StableDiffusionTextEncoderRequirementID,
		capabilitydriver.StableDiffusionVAERequirementID,
		capabilitydriver.StableDiffusionUncondDiffusionRequirementID,
	}
	bindings := make([]capabilitydriver.InvocationExactBinding, 0, len(requirementIDs))
	for index, requirementID := range requirementIDs {
		path := filepath.Join(root, fmt.Sprintf("ideogram-component-%d.gguf", index))
		payload := []byte(requirementID)
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		digestBytes := sha256.Sum256(payload)
		digest := hex.EncodeToString(digestBytes[:])
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{
			RequirementID: requirementID, ModelAssetID: fmt.Sprintf("ideogram-asset-%d", index), AbsolutePath: path,
			VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
		})
	}
	portable, err := structpb.NewStruct(map[string]any{
		"executionOptions": map[string]any{
			"steps": 4, "cfgScale": 2, "width": 64, "height": 64, "seed": 8, "threads": 2,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	plan, err := (capabilitydriver.StableDiffusionImageDriver{}).PlanImageInvocation(capabilitydriver.ImageInvocationInput{
		RecipeID:       "ideogram4",
		PortableConfig: portable,
		ExactBindings:  bindings,
		Request:        &runtimev1.ImageGenerateScenarioSpec{Prompt: "ideogram", N: proto.Int32(1), Size: "64x64", Seed: proto.Int64(8)},
	})
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

func waitForImageHostQueueLength(t *testing.T, host *ImageExecutionHost, wanted int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		host.mu.Lock()
		length := len(host.queue)
		host.mu.Unlock()
		if length == wanted {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("image Host queue did not reach length %d", wanted)
}

func testPNGBytes() []byte {
	return []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0, 'I', 'H', 'D', 'R'}
}
