package localservice

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestClassifyManagedEngineSupportSpeechUsesPlatformGate(t *testing.T) {
	tests := []struct {
		name       string
		profile    *runtimev1.LocalDeviceProfile
		wantClass  string
		wantDetail string
	}{
		{
			name:      "speech supported on linux arm64",
			profile:   &runtimev1.LocalDeviceProfile{Os: "linux", Arch: "arm64"},
			wantClass: localEngineSupportSupportedSupervised,
		},
		{
			name:       "speech attached only on windows arm64",
			profile:    &runtimev1.LocalDeviceProfile{Os: "windows", Arch: "arm64"},
			wantClass:  localEngineSupportAttachedOnly,
			wantDetail: "speech-backed supervised mode is unavailable on this host; configure an attached endpoint instead",
		},
		{
			name:       "speech unsupported without profile",
			profile:    nil,
			wantClass:  localEngineSupportUnsupported,
			wantDetail: "device profile unavailable",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotClass, gotDetail := classifyManagedEngineSupport("speech", tt.profile)
			if gotClass != tt.wantClass {
				t.Fatalf("classifyManagedEngineSupport(speech) class = %q, want %q", gotClass, tt.wantClass)
			}
			if gotDetail != tt.wantDetail {
				t.Fatalf("classifyManagedEngineSupport(speech) detail = %q, want %q", gotDetail, tt.wantDetail)
			}
		})
	}
}
