package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
)

func musicTranscriptionSpecForTest() *runtimev1.MusicTranscribeScenarioSpec {
	return &runtimev1.MusicTranscribeScenarioSpec{SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "source-owned", Range: &runtimev1.AudioFrameRange{StartFrame: 48000, EndFrame: 144000}},
		RequestedFormats: []runtimev1.MusicTranscriptionFormat{runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_ABC, runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE},
		RequestedParts:   []runtimev1.MusicTranscriptionPart{runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_LEAD_SHEET}}
}
func TestMusicTranscriptionRequestAndSubmissionIdentity(t *testing.T) {
	spec := musicTranscriptionSpecForTest()
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{ClientSubmissionId: "transcribe-author-1", Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_MusicTranscribe{MusicTranscribe: spec}}
	_, kind, err := validateLocalAppScenarioJobRequest(request)
	if err != nil || kind != runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE {
		t.Fatalf("transcription admission: %v %v", kind, err)
	}
	first, err := captureLocalAppMusicSubmission(request)
	if err != nil || first.ReservedBytes != 64<<20 {
		t.Fatalf("submission: %+v %v", first, err)
	}
	spec.RequestedFormats[0], spec.RequestedFormats[1] = spec.RequestedFormats[1], spec.RequestedFormats[0]
	second, err := captureLocalAppMusicSubmission(request)
	if err != nil || second.RequestSHA256 != first.RequestSHA256 {
		t.Fatal("a format set permutation changed author identity")
	}
	spec.SourceAudio.Range.EndFrame++
	third, err := captureLocalAppMusicSubmission(request)
	if err != nil || third.RequestSHA256 == first.RequestSHA256 {
		t.Fatal("a different source range reused the same request identity")
	}
	spec.RequestedParts = append(spec.RequestedParts, spec.RequestedParts[0])
	if validateMusicTranscriptionSpec(spec) == nil {
		t.Fatal("duplicate parts were accepted")
	}
}
func TestMusicTranscriptionProjectionRequiresCompleteOwnedResult(t *testing.T) {
	job := &runtimev1.ScenarioJob{JobId: "transcribe-job", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		MusicTranscription: &runtimev1.MusicTranscription{Scores: []*runtimev1.MusicTranscribedScore{{ArtifactId: "score", Format: runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC, Part: runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_LEAD_SHEET}},
			Origin: runtimev1.MusicScoreOrigin_MUSIC_SCORE_ORIGIN_TRANSCRIBED_ESTIMATE, SourceArtifactId: "source", Completeness: runtimev1.MusicTranscriptionCompleteness_MUSIC_TRANSCRIPTION_COMPLETENESS_UNKNOWN,
			SourceInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 48000, Channels: 2, FrameCount: 144000, DurationMs: 3000}, InputRange: &runtimev1.AudioFrameRange{StartFrame: 48000, EndFrame: 144000}},
		Artifacts: []*runtimev1.ScenarioArtifact{{ArtifactId: "score", MimeType: "text/vnd.abc", SizeBytes: 100, Sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}
	if err := validateMusicTranscriptionResult(job); err != nil {
		t.Fatal(err)
	}
	projected, err := projectLocalAppScenarioJob(job)
	if err != nil || projected.GetMusicTranscription().GetSourceArtifactId() != "source" {
		t.Fatalf("protected result: %+v %v", projected, err)
	}
	for _, mutate := range []func(*runtimev1.ScenarioJob){func(j *runtimev1.ScenarioJob) { j.Artifacts = nil }, func(j *runtimev1.ScenarioJob) { j.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING }, func(j *runtimev1.ScenarioJob) { j.MusicTranscription.SourceInfo.FrameCount += 48 }} {
		invalid := proto.Clone(job).(*runtimev1.ScenarioJob)
		mutate(invalid)
		if validateMusicTranscriptionResult(invalid) == nil {
			t.Fatal("invalid transcription result was accepted")
		}
	}
}
