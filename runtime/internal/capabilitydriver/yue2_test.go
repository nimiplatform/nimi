package capabilitydriver

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func yue2TestInput(t *testing.T) MusicInvocationInput {
	t.Helper()
	root := t.TempDir()
	return MusicInvocationInput{LoadoutID: "yue-candidate", RecipeID: YuE2RecipeID,
		ExactBindings: []InvocationExactBinding{{RequirementID: YuE2RequirementID, ModelAssetID: "yue2", BundleDir: root, AbsolutePath: filepath.Join(root, "yue2-3b-q8_0.gguf"), VerifiedContentID: YuE2VerifiedContentID, DeclaredFiles: yue2DeclaredFiles()}},
		Package:       MusicRuntimePackageInput{AudioCppVersion: "0.8.1", AudioCppPackageID: AudioCppWindowsCUDA13PackageID, AudioCppSelectedSourceRecordID: "fixed-package", AudioCppRoot: root, AudioCppExecutablePath: filepath.Join(root, "audiocpp_cli.exe"), CUDA13DependencyID: AudioCppCUDA13RuntimeDependencyID, CUDA13SelectedSourceRecordID: "fixed-cuda", CUDA13Root: root},
		Request:       &runtimev1.MusicGenerateScenarioSpec{Prompt: "restrained folk", Lyrics: "[Verse]\nThe river runs"}, StagingWAVPath: filepath.Join(root, "job", "music.wav")}
}

func TestYuE2ExactProfileAndNativeInputMapping(t *testing.T) {
	input := yue2TestInput(t)
	plan, err := (YuE2AudioCppDriver{}).PlanMusicInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	args := plan.CLIArgs()
	containsPair := func(a, b string) bool {
		for i := 0; i+1 < len(args); i++ {
			if args[i] == a && args[i+1] == b {
				return true
			}
		}
		return false
	}
	for _, pair := range [][2]string{{"--family", "yue2"}, {"--out-format", "float32"}} {
		if !containsPair(pair[0], pair[1]) {
			t.Fatalf("missing %v in %v", pair, args)
		}
	}
	_, raw := plan.RequestJSON()
	var request struct {
		Requests []struct {
			Lyrics  string            `json:"lyrics"`
			Options map[string]string `json:"options"`
		} `json:"requests"`
	}
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	if len(request.Requests) != 1 || request.Requests[0].Lyrics != input.Request.Lyrics || request.Requests[0].Options["style"] != input.Request.Prompt || request.Requests[0].Options["semantic_max_tokens"] != "500" {
		t.Fatal("request file changed author content or budget")
	}
	if plan.NewOutputObserver() == nil || plan.StagingScorePath() != filepath.Join(filepath.Dir(input.StagingWAVPath), "music", "score.abc") {
		t.Fatal("missing multi-output interpretation")
	}
	args[0] = "mutated"
	if plan.CLIArgs()[0] != "--task" {
		t.Fatal("mutable plan")
	}
	for _, change := range []func(*MusicInvocationInput){
		func(v *MusicInvocationInput) { v.Package.AudioCppVersion = "0.6.1" },
		func(v *MusicInvocationInput) { v.ExactBindings[0].DeclaredFiles = v.ExactBindings[0].DeclaredFiles[:5] },
		func(v *MusicInvocationInput) { v.ExactBindings[0].VerifiedContentID = MiniMaxMusic3VerifiedContentID },
		func(v *MusicInvocationInput) { v.Request.Instrumental = true },
		func(v *MusicInvocationInput) { v.Request.NegativePrompt = "ignored" },
		func(v *MusicInvocationInput) { v.Request.DurationSeconds = 601 },
		func(v *MusicInvocationInput) { v.Request.Lyrics = strings.Repeat("a", 20000) },
		func(v *MusicInvocationInput) { v.Extensions = []*runtimev1.ScenarioExtension{{}} },
	} {
		value := yue2TestInput(t)
		change(&value)
		if _, err := (YuE2AudioCppDriver{}).PlanMusicInvocation(value); err == nil {
			t.Fatal("unsupported input was accepted")
		}
	}
}

func TestYuE2TerminationIsExplicitAndBounded(t *testing.T) {
	for _, test := range []struct{ flag, want string }{{"1", MusicTerminationBudgetLimit}, {"0", MusicTerminationModelEnd}} {
		observer := &yue2OutputObserver{expectGeneratedScore: true}
		observer.Observe(1, []byte(strings.Repeat("noise", 20000)+"\n"))
		data := "[TIMING ts=20260921-051149] yue2.semantic.abc_truncated 0\n[TIMING ts=20260921-051153] yue2.semantic.tokens 500\n[TIMING ts=20260921-051153] yue2.semantic.truncated " + test.flag + "\n"
		for start := 0; start < len(data); start += 7 {
			end := min(start+7, len(data))
			observer.Observe(1, []byte(data[start:end]))
		}
		facts, err := observer.Facts()
		if err != nil || facts.Termination != test.want || facts.SemanticTokens != 500 {
			t.Fatalf("facts=%+v err=%v", facts, err)
		}
		observer.Observe(0, []byte("[TIMING ts=20260921-051153] yue2.semantic.truncated 0\n"))
		if _, err := observer.Facts(); err == nil {
			t.Fatal("duplicate evidence accepted")
		}
	}
	if _, err := (&yue2OutputObserver{}).Facts(); err == nil {
		t.Fatal("missing evidence became model-end")
	}
}
