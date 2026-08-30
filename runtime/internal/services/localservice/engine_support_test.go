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
		{name: "speech supported on Apple Silicon", profile: &runtimev1.LocalDeviceProfile{Os: "darwin", Arch: "arm64"}, wantClass: localEngineSupportSupportedSupervised},
		{name: "speech unsupported on linux arm64", profile: &runtimev1.LocalDeviceProfile{Os: "linux", Arch: "arm64"}, wantClass: localEngineSupportUnsupported, wantDetail: "speech supervised mode is unsupported on the exact host tuple"},
		{
			name:       "speech unsupported on windows arm64",
			profile:    &runtimev1.LocalDeviceProfile{Os: "windows", Arch: "arm64"},
			wantClass:  localEngineSupportUnsupported,
			wantDetail: "speech supervised mode is unsupported on the exact host tuple",
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

func TestClassifyManagedEngineSupportKeepsSidecarAttachedOnly(t *testing.T) {
	class, detail := classifyManagedEngineSupport("sidecar", nil)
	if class != localEngineSupportAttachedOnly || detail != "sidecar requires an explicitly admitted attached endpoint" {
		t.Fatalf("sidecar support = %q/%q", class, detail)
	}
}
