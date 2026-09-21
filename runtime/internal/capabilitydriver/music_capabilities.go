package capabilitydriver

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// @nimi-authority: rule.nimi.runtime.local-compute.audio-cpp-package
const AudioCppMusicPackageVersion = "0.8.1"

type MusicInputProjector interface {
	MusicInputCapabilities() *runtimev1.MusicInputCapabilities
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func (MiniMaxMusic3AudioCppDriver) MusicInputCapabilities() *runtimev1.MusicInputCapabilities {
	return &runtimev1.MusicInputCapabilities{Generation: []*runtimev1.MusicGenerationInputProfile{{
		LyricsMode: "required", ScoreMode: "unsupported", SupportsSeed: true, MaxDurationSeconds: 180, DefaultDurationSeconds: 20,
		MaxPromptBytes: 32768, MaxLyricsBytes: 32768,
	}}}
}

func (YuE2AudioCppDriver) MusicInputCapabilities() *runtimev1.MusicInputCapabilities {
	return &runtimev1.MusicInputCapabilities{Generation: []*runtimev1.MusicGenerationInputProfile{
		{LyricsMode: "required", ScoreMode: "unsupported", SupportsSeed: true, SupportsGeneratedScore: true,
			MaxDurationSeconds: 600, DefaultDurationSeconds: 20, MaxPromptBytes: 32768, MaxLyricsBytes: 32768},
		{LyricsMode: "required", ScoreMode: "required", ScoreFormats: []string{"abc"}, ScoreConditioning: []string{"melody-only", "melody-and-harmony"}, SupportsSeed: true,
			MaxDurationSeconds: 600, DefaultDurationSeconds: 20, MaxPromptBytes: 32768, MaxLyricsBytes: 32768, MaxScoreBytes: 1048576},
	}}
}
