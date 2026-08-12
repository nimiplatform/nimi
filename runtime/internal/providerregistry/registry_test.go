package providerregistry

import "testing"

func TestRemoteProviderSetReturnsCopy(t *testing.T) {
	set := RemoteProviderSet()
	set["mutated"] = struct{}{}

	refreshed := RemoteProviderSet()
	if _, ok := refreshed["mutated"]; ok {
		t.Fatal("expected RemoteProviderSet to return a defensive copy")
	}
}

func TestSortedProviderIDsReturnsSortedCopy(t *testing.T) {
	ids := SortedProviderIDs()
	if len(ids) == 0 {
		t.Fatal("expected provider ids")
	}
	if ids[0] > ids[len(ids)-1] {
		t.Fatalf("expected sorted provider ids, got=%v", ids)
	}

	originalFirst := ids[0]
	ids[0] = "zzzz"
	refreshed := SortedProviderIDs()
	if refreshed[0] != originalFirst {
		t.Fatal("expected SortedProviderIDs to return a defensive copy")
	}
}

func TestVoiceWorkflowProviderFamilyFlagsDoNotOverclaim(t *testing.T) {
	cases := []struct {
		provider                 string
		wantTTS                  bool
		wantVoiceReferenceAudio  bool
		wantVoiceTextDescription bool
		coverageInvariant        string
	}{
		{
			provider:                 "aws_polly",
			wantTTS:                  true,
			wantVoiceReferenceAudio:  false,
			wantVoiceTextDescription: false,
			coverageInvariant:        "plain TTS only provider must not advertise voice workflows",
		},
		{
			provider:                 "fish_audio",
			wantTTS:                  true,
			wantVoiceReferenceAudio:  true,
			wantVoiceTextDescription: false,
			coverageInvariant:        "Fish Audio model rows explicitly admit synthesis and reference-audio voice creation",
		},
		{
			provider:                 "dashscope",
			wantTTS:                  true,
			wantVoiceReferenceAudio:  true,
			wantVoiceTextDescription: true,
			coverageInvariant:        "provider-extension registry admits both voice creation sources",
		},
		{
			provider:                 "elevenlabs",
			wantTTS:                  true,
			wantVoiceReferenceAudio:  true,
			wantVoiceTextDescription: true,
			coverageInvariant:        "provider-extension registry rows admit both ElevenLabs voice creation sources",
		},
	}

	for _, c := range cases {
		t.Run(c.provider, func(t *testing.T) {
			record, ok := Lookup(c.provider)
			if !ok {
				t.Fatalf("provider %s not found", c.provider)
			}
			if record.SupportsTTS != c.wantTTS {
				t.Fatalf("%s SupportsTTS=%v, want %v (%s)", c.provider, record.SupportsTTS, c.wantTTS, c.coverageInvariant)
			}
			if record.SupportsVoiceReferenceAudio != c.wantVoiceReferenceAudio {
				t.Fatalf("%s SupportsVoiceReferenceAudio=%v, want %v (%s)", c.provider, record.SupportsVoiceReferenceAudio, c.wantVoiceReferenceAudio, c.coverageInvariant)
			}
			if record.SupportsVoiceTextDescription != c.wantVoiceTextDescription {
				t.Fatalf("%s SupportsVoiceTextDescription=%v, want %v (%s)", c.provider, record.SupportsVoiceTextDescription, c.wantVoiceTextDescription, c.coverageInvariant)
			}
		})
	}
}
