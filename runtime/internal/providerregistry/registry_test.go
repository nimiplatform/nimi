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
		provider          string
		wantTTS           bool
		wantVoiceClone    bool
		wantVoiceDesign   bool
		coverageInvariant string
	}{
		{
			provider:          "aws_polly",
			wantTTS:           true,
			wantVoiceClone:    false,
			wantVoiceDesign:   false,
			coverageInvariant: "plain TTS only provider must not advertise voice workflows",
		},
		{
			provider:          "fish_audio",
			wantTTS:           true,
			wantVoiceClone:    true,
			wantVoiceDesign:   false,
			coverageInvariant: "provider-extension registry admits voice clone but not voice design",
		},
		{
			provider:          "dashscope",
			wantTTS:           true,
			wantVoiceClone:    true,
			wantVoiceDesign:   true,
			coverageInvariant: "provider-extension registry admits both workflow lanes",
		},
		{
			provider:          "elevenlabs",
			wantTTS:           true,
			wantVoiceClone:    true,
			wantVoiceDesign:   true,
			coverageInvariant: "provider-extension registry rows admit both ElevenLabs workflow lanes",
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
			if record.SupportsVoiceClone != c.wantVoiceClone {
				t.Fatalf("%s SupportsVoiceClone=%v, want %v (%s)", c.provider, record.SupportsVoiceClone, c.wantVoiceClone, c.coverageInvariant)
			}
			if record.SupportsVoiceDesign != c.wantVoiceDesign {
				t.Fatalf("%s SupportsVoiceDesign=%v, want %v (%s)", c.provider, record.SupportsVoiceDesign, c.wantVoiceDesign, c.coverageInvariant)
			}
		})
	}
}
