package ai

import (
	"testing"
	"time"
)

func TestTimeoutDurationUsesBoundedOverride(t *testing.T) {
	tests := []struct {
		name           string
		timeoutMS      int32
		defaultTimeout time.Duration
		want           time.Duration
	}{
		{
			name:           "use default when request missing",
			timeoutMS:      0,
			defaultTimeout: defaultGenerateTimeout,
			want:           defaultGenerateTimeout,
		},
		{
			name:           "allow longer caller timeout",
			timeoutMS:      60_000,
			defaultTimeout: defaultGenerateTimeout,
			want:           60 * time.Second,
		},
		{
			name:           "allow shorter caller timeout",
			timeoutMS:      5_000,
			defaultTimeout: defaultGenerateTimeout,
			want:           5 * time.Second,
		},
		{
			name:           "clamp to runtime max",
			timeoutMS:      int32((10 * time.Minute) / time.Millisecond),
			defaultTimeout: defaultGenerateTimeout,
			want:           maxRuntimeRequestTimeout,
		},
		{
			name:           "zero default stays zero",
			timeoutMS:      0,
			defaultTimeout: 0,
			want:           0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := timeoutDuration(tt.timeoutMS, tt.defaultTimeout)
			if got != tt.want {
				t.Fatalf("timeoutDuration(%d, %s) = %s, want %s", tt.timeoutMS, tt.defaultTimeout, got, tt.want)
			}
		})
	}
}
