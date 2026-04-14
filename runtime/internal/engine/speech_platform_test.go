package engine

import "testing"

func TestSpeechSupervisedPlatformSupportedFor(t *testing.T) {
	tests := []struct {
		goos   string
		goarch string
		want   bool
	}{
		{goos: "darwin", goarch: "arm64", want: true},
		{goos: "darwin", goarch: "amd64", want: true},
		{goos: "linux", goarch: "amd64", want: true},
		{goos: "linux", goarch: "arm64", want: true},
		{goos: "windows", goarch: "amd64", want: true},
		{goos: "windows", goarch: "arm64", want: false},
		{goos: "freebsd", goarch: "amd64", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.goos+"-"+tt.goarch, func(t *testing.T) {
			if got := SpeechSupervisedPlatformSupportedFor(tt.goos, tt.goarch); got != tt.want {
				t.Fatalf("SpeechSupervisedPlatformSupportedFor(%q, %q) = %v, want %v", tt.goos, tt.goarch, got, tt.want)
			}
		})
	}
}
