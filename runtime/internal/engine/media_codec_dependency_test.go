package engine

import (
	"archive/zip"
	"context"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/videomedia"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestMediaCodecPinsAndIncompleteArchives(t *testing.T) {
	for _, tuple := range [][2]string{{"windows", "amd64"}, {"darwin", "arm64"}} {
		spec, err := mediaCodecSpecFor(tuple[0], tuple[1])
		if err != nil || len(spec.hashes) != 2 || len(spec.archives) == 0 {
			t.Fatalf("missing tuple: %v %v", spec, err)
		}
		for _, archive := range spec.archives {
			if len(archive.sha256) != 64 || archive.bytes <= 0 {
				t.Fatal("unbound archive")
			}
		}
	}
	if MediaCodecSupported("linux", "amd64") {
		t.Fatal("unsupported platform admitted")
	}
	file := filepath.Join(t.TempDir(), "incomplete.zip")
	f, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(f)
	entry, err := writer.Create("ffmpeg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("incomplete")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if err := extractMediaCodecArchive(file, t.TempDir(), map[string]string{"ffmpeg": "bin/ffmpeg", "ffprobe": "bin/ffprobe"}); err == nil {
		t.Fatal("partial supply accepted")
	}
}

// Explicit network test. All downloads and outputs belong to this test root.
func TestMediaCodecCleanAcquisition(t *testing.T) {
	if os.Getenv("NIMI_TEST_MEDIA_CODEC_DOWNLOAD") != "1" {
		t.Skip("explicit network materialization")
	}
	root := t.TempDir()
	manager, err := NewManager(testLogger(), ManagedRoots{Environments: filepath.Join(root, "environments"), Dependencies: filepath.Join(root, "dependencies")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := manager.ResolveMediaCodecDependency(context.Background()); err == nil {
		t.Fatal("read-only resolution invented supply")
	}
	supply, err := manager.EnsureMediaCodecDependency(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(supply.VerifiedArtifacts) != 2 {
		t.Fatal(supply)
	}
	ffmpeg, probe, err := manager.ResolveMediaCodecDependency(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := videomedia.VerifyCodecRuns(context.Background(), ffmpeg, probe); err != nil {
		t.Fatal(err)
	}
	processor, err := audiomedia.New(ffmpeg, probe)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source.mp3")
	command := exec.CommandContext(context.Background(), ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=0.1", "-c:a", "libmp3lame", source)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("fixture encode: %v %s", err, output)
	}
	output, err := processor.Prepare(context.Background(), audiomedia.Input{Path: source, MIMEType: "audio/mpeg"}, root)
	if err != nil {
		t.Fatal(err)
	}
	if output.Facts.FrameCount == 0 || output.Facts.SampleRateHz != 44100 {
		t.Fatal(output.Facts)
	}
	if _, err := os.Stat(filepath.Join(supply.CanonicalRoot, "LICENSE.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ffmpeg, []byte("damaged"), 0755); err != nil {
		t.Fatal(err)
	}
	if _, _, err := manager.ResolveMediaCodecDependency(context.Background()); err == nil {
		t.Fatal("damaged supply accepted")
	}
}
