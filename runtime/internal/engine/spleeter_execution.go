package engine

import (
	"context"
	"encoding/json"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"io"
	"os"
	"path/filepath"
	"reflect"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.spleeter-local-separation
func (host *SpeechExecutionHost) executeSpleeterSeparation(ctx context.Context, plan *capabilitydriver.AudioSeparateInvocationPlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.AudioSeparationResult, error) {
	p := plan.PythonExecution()
	group := plan.SpleeterGroup()
	facts, ok := capabilitydriver.SpleeterFacts(group)
	fail := func(kind localexecution.FailureKind, e error) (localexecution.AudioSeparationResult, error) {
		return localexecution.AudioSeparationResult{}, speechHostError(kind, e)
	}
	if !ok || p == nil || p.ConsumerID != SpleeterConsumerID || p.InterpreterPath != managedPythonPath(p.ProfileRoot) || p.ScriptPath != filepath.Join(p.ProfileRoot, "spleeter_driver.py") || p.SelectedSourceRecordID == "" || plan.DriverID() != capabilitydriver.SpleeterDriverID || !filepath.IsAbs(plan.SourcePath()) || plan.NativeOutDir() != filepath.Join(filepath.Dir(plan.SourcePath()), "stems") || plan.NativeModelBinding().VerifiedContentID != facts.ContentID {
		return fail(localexecution.FailureContentMismatch, fmt.Errorf("Spleeter captured plan is incomplete"))
	}
	identity, e := ResolvePythonDependencyProfileIdentity(p.ConsumerID, "windows/amd64", "cpu")
	if e != nil {
		return fail(localexecution.FailureLoad, e)
	}
	manifest, e := ReadPythonDependencyProfileManifest(p.ProfileRoot)
	if e != nil || manifest.Identity != identity || p.ProfileDigest != identity.ProfileDigest || p.DriverBundleDigest != identity.DriverBundleDigest {
		return fail(localexecution.FailureContentMismatch, fmt.Errorf("Spleeter profile capture differs from immutable composition"))
	}
	if e := verifySpleeterDriverBundle(p.ProfileRoot); e != nil {
		return fail(localexecution.FailureContentMismatch, e)
	}
	release, e := host.lease.acquire(ctx)
	if e != nil {
		return fail(localexecution.FailureCanceled, e)
	}
	defer release()
	if e := beginSpeechExecution(ctx, onStart); e != nil {
		return localexecution.AudioSeparationResult{}, e
	}
	out := plan.NativeOutDir()
	if e := os.MkdirAll(out, 0o700); e != nil {
		return fail(localexecution.FailureLoad, e)
	}
	names := []string{"vocals", "accompaniment"}
	if group == 4 {
		names = []string{"vocals", "drums", "bass", "other"}
	}
	cleanup := func() {
		for _, name := range append(names, "background") {
			_ = os.Remove(filepath.Join(out, name+".wav"))
		}
		_ = os.Remove(filepath.Join(out, "result.json"))
	}
	outcome, e := runAudioCppProcess(ctx, audioCppProcessSpec{executablePath: p.InterpreterPath, workingDir: p.ProfileRoot, pythonProfileRoot: p.ProfileRoot, args: plan.NativeCLIArgs(), stagingOutputPath: filepath.Join(out, "result.json"), modelBindings: plan.ModelFiles()})
	if e != nil {
		cleanup()
		return localexecution.AudioSeparationResult{}, e
	}
	raw, e := readAudioCppBoundedFile(filepath.Join(out, "result.json"), 4096)
	if e != nil {
		cleanup()
		return fail(localexecution.FailureInference, e)
	}
	var native struct {
		Protocol string   `json:"protocol"`
		Group    int      `json:"group"`
		Rate     int      `json:"sample_rate"`
		Channels int      `json:"channels"`
		Frames   uint64   `json:"frames"`
		Stems    []string `json:"stems"`
	}
	if json.Unmarshal(raw, &native) != nil || native.Protocol != capabilitydriver.SpleeterProtocol || native.Group != group || native.Rate != 44100 || native.Channels != 2 || native.Frames != plan.SourceInfo().GetFrameCount() || !reflect.DeepEqual(native.Stems, names) {
		cleanup()
		return fail(localexecution.FailureInference, fmt.Errorf("Spleeter result protocol or source facts differ"))
	}
	var audioFacts audiomedia.Facts
	for _, name := range names {
		audioFacts, e = audiomedia.InspectCanonical(ctx, filepath.Join(out, name+".wav"))
		if e != nil {
			cleanup()
			return fail(localexecution.FailureInference, e)
		}
		if e = nativeStemsPreserveSource(audioFacts, plan.SourceInfo()); e != nil {
			cleanup()
			return fail(localexecution.FailureInference, e)
		}
	}
	background := filepath.Join(out, "background.wav")
	if group == 2 {
		e = os.Rename(filepath.Join(out, "accompaniment.wav"), background)
	} else {
		files := []*os.File{}
		for _, name := range []string{"drums", "bass", "other"} {
			f, err := os.Open(filepath.Join(out, name+".wav"))
			if err != nil {
				for _, opened := range files {
					_ = opened.Close()
				}
				cleanup()
				return fail(localexecution.FailureInference, err)
			}
			files = append(files, f)
		}
		readers := make([]io.ReadSeeker, len(files))
		for i, f := range files {
			readers[i] = f
		}
		_, e = audiomedia.SumCanonical(ctx, readers, audioFacts, background)
		for _, f := range files {
			_ = f.Close()
		}
	}
	if e != nil {
		cleanup()
		return fail(localexecution.FailureInference, e)
	}
	openStem := func(name string) (io.ReadCloser, error) {
		path := filepath.Join(out, name+".wav")
		f, e := os.Open(path)
		if e != nil {
			return nil, e
		}
		return &nativeStemFile{file: f, path: path}, nil
	}
	vocals, e := openStem("vocals")
	if e != nil {
		cleanup()
		return fail(localexecution.FailureInference, e)
	}
	bg, e := openStem("background")
	if e != nil {
		_ = vocals.Close()
		cleanup()
		return fail(localexecution.FailureInference, e)
	}
	result := localexecution.AudioSeparationResult{Vocals: vocals, Background: bg, SampleRateHz: 44100, Channels: 2, SampleCount: int64(audioFacts.FrameCount), Usage: &runtimev1.UsageStats{ComputeMs: outcome.computeMS}}
	if plan.IncludeInstrumentParts() {
		for _, part := range []struct {
			Name string
			Kind runtimev1.AudioInstrumentPartKind
		}{{"drums", runtimev1.AudioInstrumentPartKind_AUDIO_INSTRUMENT_PART_KIND_DRUMS}, {"bass", runtimev1.AudioInstrumentPartKind_AUDIO_INSTRUMENT_PART_KIND_BASS}, {"other", runtimev1.AudioInstrumentPartKind_AUDIO_INSTRUMENT_PART_KIND_OTHER}} {
			body, e := openStem(part.Name)
			if e != nil {
				_ = vocals.Close()
				_ = bg.Close()
				for _, old := range result.Instrument {
					_ = old.Body.Close()
				}
				cleanup()
				return fail(localexecution.FailureInference, e)
			}
			result.Instrument = append(result.Instrument, localexecution.AudioInstrumentPartBody{Kind: part.Kind, Body: body})
		}
	} else if group == 4 {
		for _, name := range []string{"drums", "bass", "other"} {
			_ = os.Remove(filepath.Join(out, name+".wav"))
		}
	}
	_ = os.Remove(filepath.Join(out, "result.json"))
	return result, nil
}
