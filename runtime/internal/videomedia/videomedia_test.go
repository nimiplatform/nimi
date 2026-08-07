package videomedia

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func TestNewFailsClosedForUnavailableExecutables(t *testing.T) {
	tests := []struct {
		name   string
		ffmpeg string
		probe  string
	}{
		{name: "empty", ffmpeg: "", probe: ""},
		{name: "missing ffmpeg", ffmpeg: filepath.Join(t.TempDir(), "missing-ffmpeg"), probe: filepath.Join(t.TempDir(), "missing-ffprobe")},
		{name: "directory", ffmpeg: t.TempDir(), probe: t.TempDir()},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			processor, err := New(test.ffmpeg, test.probe)
			if err == nil || processor != nil || FailureKindOf(err) != FailureUnavailable {
				t.Fatalf("New() = processor=%v error=%v kind=%q", processor, err, FailureKindOf(err))
			}
		})
	}
}

func TestEncodeMapsNonzeroCodecProcessFailure(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	processor, err := New(executable, executable)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	plan := videoPlanForTest(t, 5)
	_, err = processor.EncodeAndInspect(context.Background(), plan, rawCandidateForTest(plan))
	if err == nil || FailureKindOf(err) != FailureEncode {
		t.Fatalf("EncodeAndInspect() error=%v kind=%q", err, FailureKindOf(err))
	}
}

func TestValidateCandidateRejectsEveryRawContractViolation(t *testing.T) {
	plan := videoPlanForTest(t, 5)
	valid := rawCandidateForTest(plan)
	tests := []struct {
		name   string
		mutate func(*localexecution.RawAVCandidate)
	}{
		{name: "empty frames", mutate: func(value *localexecution.RawAVCandidate) { value.Frames = nil }},
		{name: "reported frame count", mutate: func(value *localexecution.RawAVCandidate) { value.FrameCount++ }},
		{name: "frame slice count", mutate: func(value *localexecution.RawAVCandidate) { value.Frames = value.Frames[:len(value.Frames)-1] }},
		{name: "frame width", mutate: func(value *localexecution.RawAVCandidate) { value.Frames[0].Width++ }},
		{name: "frame height", mutate: func(value *localexecution.RawAVCandidate) { value.Frames[0].Height++ }},
		{name: "rgb bytes", mutate: func(value *localexecution.RawAVCandidate) {
			value.Frames[0].RGBBytes = value.Frames[0].RGBBytes[:len(value.Frames[0].RGBBytes)-1]
		}},
		{name: "fps", mutate: func(value *localexecution.RawAVCandidate) { value.FPS = 23 }},
		{name: "empty pcm", mutate: func(value *localexecution.RawAVCandidate) { value.Audio.PCMSamples = nil }},
		{name: "channels", mutate: func(value *localexecution.RawAVCandidate) { value.Audio.Channels = 1 }},
		{name: "sample rate", mutate: func(value *localexecution.RawAVCandidate) { value.Audio.SampleRate = 44100 }},
		{name: "interleaving", mutate: func(value *localexecution.RawAVCandidate) { value.Audio.PCMSamples = append(value.Audio.PCMSamples, 0) }},
		{name: "non finite", mutate: func(value *localexecution.RawAVCandidate) { value.Audio.PCMSamples[0] = float32(math.NaN()) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := cloneRawCandidate(valid)
			test.mutate(&candidate)
			err := ValidateCandidate(plan, candidate)
			if err == nil || FailureKindOf(err) != FailureMedia {
				t.Fatalf("ValidateCandidate() error=%v kind=%q", err, FailureKindOf(err))
			}
		})
	}
	if err := ValidateCandidate(plan, cloneRawCandidate(valid)); err != nil {
		t.Fatalf("valid candidate: %v", err)
	}
}

func TestFFmpegEncodeAndInspectIntegration(t *testing.T) {
	dir := strings.TrimSpace(os.Getenv("NIMI_TEST_FFMPEG_DIR"))
	if dir == "" {
		t.Skip("NIMI_TEST_FFMPEG_DIR is not set")
	}
	ffmpegName, ffprobeName := "ffmpeg", "ffprobe"
	if strings.EqualFold(filepath.Ext(os.Args[0]), ".exe") {
		ffmpegName, ffprobeName = "ffmpeg.exe", "ffprobe.exe"
	}
	processor, err := New(filepath.Join(dir, ffmpegName), filepath.Join(dir, ffprobeName))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	plan := videoPlanForTest(t, 5)
	candidate := rawCandidateForTest(plan)
	result, err := processor.EncodeAndInspect(context.Background(), plan, candidate)
	if err != nil {
		t.Fatalf("EncodeAndInspect: %v", err)
	}
	if len(result.Bytes) < 12 || string(result.Bytes[4:8]) != "ftyp" {
		t.Fatalf("encoded payload is not an MP4: %d bytes", len(result.Bytes))
	}
	if result.Facts.MIMEType != MIMETypeMP4 || result.Facts.SizeBytes != int64(len(result.Bytes)) ||
		result.Facts.Width != 64 || result.Facts.Height != 64 || result.Facts.FPS != 24 || result.Facts.FrameCount != 5 ||
		result.Facts.Channels != 2 || result.Facts.SampleRate != 32000 || result.Facts.Duration <= 0 {
		t.Fatalf("inspected facts = %+v", result.Facts)
	}
	digest := sha256.Sum256(result.Bytes)
	if result.Facts.SHA256 != hex.EncodeToString(digest[:]) {
		t.Fatalf("sha256 = %q", result.Facts.SHA256)
	}
}

func videoPlanForTest(t *testing.T, frameCount int) *capabilitydriver.VideoInvocationPlan {
	t.Helper()
	root := t.TempDir()
	requirements := []string{
		capabilitydriver.StableDiffusionVideoFL2VARequirementID,
		capabilitydriver.StableDiffusionVideoRef2VARequirementID,
		capabilitydriver.StableDiffusionVideoEncoderRequirementID,
		capabilitydriver.StableDiffusionVideoVAERequirementID,
		capabilitydriver.StableDiffusionAudioVAERequirementID,
	}
	bindings := make([]capabilitydriver.InvocationExactBinding, 0, len(requirements))
	for index, requirement := range requirements {
		digestBytes := sha256.Sum256([]byte(requirement))
		digest := hex.EncodeToString(digestBytes[:])
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{
			RequirementID: requirement, LocalAssetID: "asset-" + requirement,
			AbsolutePath:      filepath.Join(root, "model-"+string(rune('a'+index))+".bin"),
			VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
		})
	}
	plan, err := (capabilitydriver.StableDiffusionVideoDriver{}).PlanVideoInvocation(capabilitydriver.VideoInvocationInput{
		ConfigurationID: "video-media-test", ExactBindings: bindings,
		Request: capabilitydriver.VideoInvocationRequest{
			Prompt: "a test clip", Width: 64, Height: 64, FrameCount: frameCount, FPS: 24, GenerateAudio: true,
		},
	})
	if err != nil {
		t.Fatalf("PlanVideoInvocation: %v", err)
	}
	return plan
}

func rawCandidateForTest(plan *capabilitydriver.VideoInvocationPlan) localexecution.RawAVCandidate {
	width, height := plan.Size()
	frames := make([]localexecution.RawVideoFrame, plan.FrameCount())
	for frameIndex := range frames {
		pixels := make([]byte, width*height*3)
		for offset := 0; offset < len(pixels); offset += 3 {
			pixels[offset] = byte((frameIndex * 37) % 255)
			pixels[offset+1] = byte((offset / 3) % 255)
			pixels[offset+2] = 128
		}
		frames[frameIndex] = localexecution.RawVideoFrame{RGBBytes: pixels, Width: width, Height: height}
	}
	samplesPerChannel := int(math.Round(float64(plan.FrameCount()) / 24 * 32000))
	pcm := make([]float32, samplesPerChannel*2)
	for sample := 0; sample < samplesPerChannel; sample++ {
		value := float32(0.1 * math.Sin(2*math.Pi*440*float64(sample)/32000))
		pcm[sample*2], pcm[sample*2+1] = value, value
	}
	return localexecution.RawAVCandidate{
		Frames: frames, FrameCount: plan.FrameCount(), FPS: 24,
		Audio: localexecution.RawAudio{PCMSamples: pcm, Channels: 2, SampleRate: 32000}, ComputeMS: 12,
	}
}

func cloneRawCandidate(value localexecution.RawAVCandidate) localexecution.RawAVCandidate {
	out := value
	out.Frames = make([]localexecution.RawVideoFrame, len(value.Frames))
	for index, frame := range value.Frames {
		out.Frames[index] = frame
		out.Frames[index].RGBBytes = append([]byte(nil), frame.RGBBytes...)
	}
	out.Audio.PCMSamples = append([]float32(nil), value.Audio.PCMSamples...)
	return out
}
