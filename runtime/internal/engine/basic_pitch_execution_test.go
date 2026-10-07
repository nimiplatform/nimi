package engine

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func TestBasicPitchExecutionChecksCurrentHostProfileBeforeSource(t *testing.T) {
	platform := currentGOOS() + "/" + currentGOARCH()
	identity, err := ResolvePythonDependencyProfileIdentity(BasicPitchConsumerID, platform, "cpu")
	if err != nil {
		t.Skipf("Basic Pitch is not admitted on %s", platform)
	}
	root := t.TempDir()
	profileRoot := filepath.Join(root, identity.ProfileDigest)
	files, err := PythonDependencyProfileStaticFiles(BasicPitchConsumerID, identity)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		path := filepath.Join(profileRoot, file.RelativePath)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, file.Content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := writePythonDependencyProfileManifest(profileRoot, BasicPitchConsumerID, identity); err != nil {
		t.Fatal(err)
	}
	plan, err := (capabilitydriver.BasicPitchDriver{}).PlanMusicTranscriptionInvocation(capabilitydriver.MusicTranscriptionInvocationInput{
		RecipeID: capabilitydriver.BasicPitchRecipeID,
		ExactBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: capabilitydriver.BasicPitchRequirementID, VerifiedContentID: capabilitydriver.BasicPitchVerifiedContentID, EntrySHA256: capabilitydriver.BasicPitchModelSHA256,
			BundleDir: root, AbsolutePath: filepath.Join(root, filepath.FromSlash(capabilitydriver.BasicPitchEntry)), DeclaredFiles: []string{"LICENSE", "NOTICE", capabilitydriver.BasicPitchEntry}}},
		DependencySources: []capabilitydriver.InvocationExactDependencySource{{DependencyFamily: "python.package-set", ConsumerScope: BasicPitchConsumerID, CanonicalRoot: profileRoot, SelectedSourceRecordID: "profile-source", Version: identity.ProfileDigest,
			Hashes: map[string]string{"profile_digest": identity.ProfileDigest, "driver_bundle_sha256": identity.DriverBundleDigest}}},
		Request: &runtimev1.MusicTranscribeScenarioSpec{SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "owned-source"},
			RequestedParts: []runtimev1.MusicTranscriptionPart{runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_NOTE_EVENTS}, RequestedFormats: []runtimev1.MusicTranscriptionFormat{runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_MIDI}},
		SourceInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 22050, Channels: 1, FrameCount: 22050}, SourcePath: filepath.Join(root, "source.wav"), StagingDir: root,
	})
	if err != nil {
		t.Fatal(err)
	}
	// No inference fixture: the missing source must be reached only after this
	// host's real embedded environment identity and static Driver are accepted.
	if _, err := runBasicPitchProcess(context.Background(), plan); err == nil || !strings.Contains(err.Error(), "canonical source differs") {
		t.Fatal("current host profile was not accepted before source validation", err)
	}
	otherPlatform := "windows/amd64"
	if platform == otherPlatform {
		otherPlatform = "darwin/arm64"
	}
	other, err := ResolvePythonDependencyProfileIdentity(BasicPitchConsumerID, otherPlatform, "cpu")
	if err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(profileRoot, PythonDependencyProfileManifestFileName)
	if err := os.Remove(manifest); err != nil {
		t.Fatal(err)
	}
	if err := writePythonDependencyProfileManifest(profileRoot, BasicPitchConsumerID, other); err != nil {
		t.Fatal(err)
	}
	if _, err := runBasicPitchProcess(context.Background(), plan); err == nil || !strings.Contains(err.Error(), "profile identity changed") {
		t.Fatal("different platform profile accepted", err)
	}
}
