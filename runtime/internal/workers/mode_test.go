package workers

import "testing"

func TestEnabledRespectsEnvOverride(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_ENABLE_WORKERS", "1")
	if !Enabled() {
		t.Fatalf("expected worker mode enabled when env=1")
	}

	t.Setenv("NIMI_RUNTIME_ENABLE_WORKERS", "0")
	if Enabled() {
		t.Fatalf("expected worker mode disabled when env=0")
	}
}
