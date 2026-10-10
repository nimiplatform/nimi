package ai

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"github.com/nimiplatform/nimi/runtime/internal/videomedia"
)

func TestMusicVideoCaptureInspectsOriginalOwnedFileWithoutStagingCopy(t *testing.T) {
	dir := os.Getenv("NIMI_TEST_FFMPEG_DIR")
	if dir == "" {
		t.Skip("matching real codec fixture unavailable")
	}
	suffix := ""
	if runtime.GOOS == "windows" {
		suffix = ".exe"
	}
	ffmpeg, ffprobe := filepath.Join(dir, "ffmpeg"+suffix), filepath.Join(dir, "ffprobe"+suffix)
	codec, err := videomedia.New(ffmpeg, ffprobe)
	if err != nil {
		t.Fatal(err)
	}
	input := filepath.Join(t.TempDir(), "input.mp4")
	if output, err := exec.Command(ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=green:s=480x480:r=30", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", input).CombinedOutput(); err != nil {
		t.Fatalf("encode actual video: %v %s", err, output)
	}
	data, err := os.ReadFile(input)
	if err != nil {
		t.Fatal(err)
	}
	store, err := runtimeartifact.NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", AppID: "nimi.desktop"}
	if err := store.Put("owned-video", runtimeartifact.ArtifactRecord{Bytes: data, MimeType: "video/mp4", Owner: owner}); err != nil {
		t.Fatal(err)
	}
	svc := newTestService(nil)
	svc.SetRuntimeArtifactStore(store)
	svc.SetLocalVideoMediaPipeline(codec)
	// A nonexistent staging root makes accidental copy creation observable.
	svc.localMusicStagingRoot = filepath.Join(t.TempDir(), "must-not-be-created")
	head := &runtimev1.ScenarioRequestHead{AppId: owner.AppID, SubjectUserId: owner.SubjectUserID}
	reference, err := svc.captureMusicVideoReference(context.Background(), head, &runtimev1.MusicVideoReference{ArtifactId: "owned-video"}, 2)
	if err != nil || reference == nil || !bytes.Equal(reference.Bytes, data) {
		t.Fatalf("borrowed actual video capture: %v", err)
	}
	if _, err := os.Stat(svc.localMusicStagingRoot); !os.IsNotExist(err) {
		t.Fatalf("capture created physical staging: %v", err)
	}
	if err := store.Delete("owned-video"); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(reference.Bytes, data) {
		t.Fatal("captured input changed after original deletion")
	}
}
