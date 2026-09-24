package ai

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

func canonicalUploadFixture(t *testing.T) []byte {
	t.Helper()
	// A standard float WAV with a 16-byte fmt chunk, unlike the preparer's own
	// 18-byte fmt encoding. This is a container/ownership fixture, not music.
	var output bytes.Buffer
	output.WriteString("RIFF")
	_ = binary.Write(&output, binary.LittleEndian, uint32(64))
	output.WriteString("WAVEfmt ")
	_ = binary.Write(&output, binary.LittleEndian, uint32(16))
	for _, value := range []any{uint16(3), uint16(2), uint32(48000), uint32(384000), uint16(8), uint16(32)} {
		if err := binary.Write(&output, binary.LittleEndian, value); err != nil {
			t.Fatal(err)
		}
	}
	output.WriteString("fact")
	_ = binary.Write(&output, binary.LittleEndian, uint32(4))
	_ = binary.Write(&output, binary.LittleEndian, uint32(2))
	output.WriteString("data")
	_ = binary.Write(&output, binary.LittleEndian, uint32(16))
	_ = binary.Write(&output, binary.LittleEndian, []float32{0.1, -0.1, 1.25, -1.25})
	return output.Bytes()
}

func canonicalCopyTestService(t *testing.T) *Service {
	t.Helper()
	svc := newTestService(nil)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	// Only the already-canonical copy path is used by these unit tests.
	processor, err := audiomedia.New(executable, executable)
	if err != nil {
		t.Fatal(err)
	}
	svc.SetCanonicalAudioPreparation(processor, t.TempDir())
	return svc
}

func TestCanonicalAudioArtifactRecopyReleasesDiskReadPin(t *testing.T) {
	svc := canonicalCopyTestService(t)
	store, err := runtimeartifact.NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc.SetRuntimeArtifactStore(store)
	first, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{Bytes: canonicalUploadFixture(t), MimeType: "audio/wav", AudioPreparation: &runtimev1.LocalAppCanonicalAudioPreparation{}})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(localAppArtifactUploadContext(), 5*time.Second)
	defer cancel()
	second, err := svc.UploadLocalAppArtifact(ctx, &runtimev1.UploadLocalAppArtifactRequest{SourceArtifactId: first.GetArtifactId(), MimeType: "audio/wav", AudioPreparation: &runtimev1.LocalAppCanonicalAudioPreparation{}})
	if err != nil {
		t.Fatal(err)
	}
	left, _ := store.Get(first.GetArtifactId())
	right, _ := store.Get(second.GetArtifactId())
	if first.GetArtifactId() == second.GetArtifactId() || !bytes.Equal(left.Bytes, right.Bytes) || second.GetAudioInfo().GetFrameCount() != 2 {
		t.Fatal("canonical recopy changed the source or aliased its identity")
	}
	if right.CanonicalAudio == nil || right.CanonicalAudio.FrameCount != 2 || right.CanonicalAudio.DataOffset != 56 {
		t.Fatal("canonical frame coordinates were not persisted")
	}
	if second.GetExpiresAt() == nil || !right.MusicRecoveryUntil.Equal(second.GetExpiresAt().AsTime()) || time.Until(right.MusicRecoveryUntil) < 24*time.Hour-time.Minute {
		t.Fatal("canonical lifetime was not committed with the actual body")
	}
}

func TestCanonicalAudioUploadPersistsOnlyDerivedOwnerAndActualFacts(t *testing.T) {
	svc := canonicalCopyTestService(t)
	payload := canonicalUploadFixture(t)
	result, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{
		Bytes: payload, MimeType: "audio/wav", AudioPreparation: &runtimev1.LocalAppCanonicalAudioPreparation{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.GetAudioInfo().GetFrameCount() != 2 || result.GetAudioInfo().GetSampleRateHz() != 48000 || result.GetAudioInfo().GetChannels() != 2 || result.GetSizeBytes() != int64(len(payload)) {
		t.Fatalf("incorrect actual facts: %+v", result)
	}
	record, ok := svc.runtimeArtifacts.Get(result.GetArtifactId())
	if !ok || record.Owner == nil || record.Owner.SubjectUserID != "account-1" || record.Owner.RegisteredAppSubject != "principal-1" || !bytes.Equal(record.Bytes, payload) {
		t.Fatalf("incorrect custody: %+v", record)
	}
	second, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{
		SourceArtifactId: result.GetArtifactId(), MimeType: "audio/wav", AudioPreparation: &runtimev1.LocalAppCanonicalAudioPreparation{},
	})
	if err != nil || second.GetArtifactId() == result.GetArtifactId() || second.GetAudioInfo().GetFrameCount() != 2 {
		t.Fatalf("canonical reference result=%+v err=%v", second, err)
	}
	entries, err := os.ReadDir(svc.canonicalAudioStagingRoot)
	if err != nil || len(entries) != 0 {
		t.Fatalf("staging leaked: %v %v", entries, err)
	}
}

func TestCanonicalAudioUploadRejectsForeignAndAmbiguousSources(t *testing.T) {
	svc := canonicalCopyTestService(t)
	payload := canonicalUploadFixture(t)
	if err := svc.runtimeArtifacts.Put("foreign", runtimeartifact.ArtifactRecord{Bytes: payload, MimeType: "audio/wav", Owner: &runtimeartifact.ArtifactOwner{SubjectUserID: "account-1", RegisteredAppSubject: "principal-2", AppID: "other-producer"}}); err != nil {
		t.Fatal(err)
	}
	_, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{
		SourceArtifactId: "foreign", MimeType: "audio/wav", AudioPreparation: &runtimev1.LocalAppCanonicalAudioPreparation{},
	})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	for _, req := range []*runtimev1.UploadLocalAppArtifactRequest{
		{Bytes: payload, SourceArtifactId: "foreign", MimeType: "audio/wav", AudioPreparation: &runtimev1.LocalAppCanonicalAudioPreparation{}},
		{AppAssetRelativePath: "../outside.wav", MimeType: "audio/wav", AudioPreparation: &runtimev1.LocalAppCanonicalAudioPreparation{}},
		{SourceArtifactId: "foreign", MimeType: "audio/wav"},
		{Bytes: payload, MimeType: "audio/wav", AudioPreparation: &runtimev1.LocalAppCanonicalAudioPreparation{TargetSampleRateHz: 1}},
	} {
		_, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), req)
		assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
	if svc.runtimeArtifacts.Len() != 1 {
		t.Fatal("rejected requests published artifacts")
	}
}

func TestCanonicalAudioUploadLargeRecordingIntegration(t *testing.T) {
	ffmpeg, ffprobe, recording := os.Getenv("NIMI_AUDIO_TEST_FFMPEG"), os.Getenv("NIMI_AUDIO_TEST_FFPROBE"), os.Getenv("NIMI_AUDIO_TEST_SOURCE")
	if ffmpeg == "" || ffprobe == "" || recording == "" {
		t.Skip("real recording and managed codec were not supplied")
	}
	processor, err := audiomedia.New(ffmpeg, ffprobe)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	assets, err := appstorage.NewAssetStore(root, appstorage.AssetPolicy{})
	if err != nil {
		t.Fatal(err)
	}
	owner := appstorage.ManagedOwner{AccountID: "account-1", RegisteredAppSubject: "principal-1"}
	source, err := os.Open(recording)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = source.Close() }()
	if _, err := assets.Write(context.Background(), owner, "sources/原曲.mp3", "audio/mpeg", false, source); err != nil {
		t.Fatal(err)
	}
	store, err := runtimeartifact.NewDiskStore(filepath.Join(root, "runtime-artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	svc := newTestService(nil)
	svc.SetRuntimeArtifactStore(store)
	svc.SetLocalAppAudioSource(assets.Open)
	svc.SetCanonicalAudioPreparation(processor, filepath.Join(root, "staging"))
	result, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{
		AppAssetRelativePath: "sources/原曲.mp3", MimeType: "audio/mpeg", AudioPreparation: &runtimev1.LocalAppCanonicalAudioPreparation{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.GetSizeBytes() <= runtimeartifact.MaxInlineBytes || result.GetAudioInfo().GetFrameCount() == 0 {
		t.Fatalf("fixture did not exercise large real output: %+v", result)
	}
	_, err = svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: result.GetArtifactId()})
	assertLocalAppTextCandidateError(t, err, codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	opened, ok := store.Open(context.Background(), result.GetArtifactId())
	if !ok {
		t.Fatal("actual committed body is unavailable")
	}
	defer func() { _ = opened.Body.Close() }()
	if _, err := assets.Write(context.Background(), owner, "sources/原曲.mp3", "audio/mpeg", true, io.NopCloser(bytes.NewReader([]byte("changed source")))); err != nil {
		t.Fatal(err)
	}
	adopted, err := assets.Adopt(context.Background(), owner, "results/canonical.wav", false, appstorage.VerifiedAssetInput{MediaType: opened.Record.MimeType, SizeBytes: opened.Record.SizeBytes, SHA256: opened.Record.ContentSHA256, Body: opened.Body})
	if err != nil || adopted.SizeBytes != result.GetSizeBytes() {
		t.Fatalf("large adoption: %+v %v", adopted, err)
	}
	t.Logf("in-process handler: real MP3 -> %d frames / %d bytes -> App asset; original source overwrite did not alter custody", result.GetAudioInfo().GetFrameCount(), result.GetSizeBytes())
	// The caller decision is a test fixture. This exercises the real handler,
	// codec and disk stores, not Desktop/native protected-session acceptance.
}
