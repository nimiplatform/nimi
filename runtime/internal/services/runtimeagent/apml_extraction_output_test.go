package runtimeagent

import (
	"strings"
	"testing"
)

func TestDecodeStrictAPMLRejectsUnsupportedHierarchy(t *testing.T) {
	tests := []struct {
		name     string
		rootName string
		raw      string
		wantErr  string
	}{
		{
			name:     "retired life Memory candidate tag",
			rootName: "life-turn",
			raw:      `<life-turn><summary>ok</summary><canonical-memory-candidates></canonical-memory-candidates></life-turn>`,
			wantErr:  "contains unsupported <canonical-memory-candidates> tag",
		},
		{
			name:     "retired sidecar Memory candidate tag",
			rootName: "chat-track-sidecar",
			raw:      `<chat-track-sidecar><canonical-memory-candidates></canonical-memory-candidates></chat-track-sidecar>`,
			wantErr:  "contains unsupported <canonical-memory-candidates> tag",
		},
		{
			name:     "unknown root attribute",
			rootName: "life-turn",
			raw:      `<life-turn version="1"><summary>ok</summary></life-turn>`,
			wantErr:  "unsupported version attribute",
		},
		{
			name:     "duplicate action attribute",
			rootName: "chat-track-sidecar",
			raw:      `<chat-track-sidecar><next-hook-intent trigger-family="TIME" trigger-family="EVENT" effect="FOLLOW_UP_TURN"><time delay="60s"/></next-hook-intent></chat-track-sidecar>`,
			wantErr:  "duplicate trigger-family attribute",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var payload any
			switch tt.rootName {
			case "life-turn":
				payload = &lifeTurnExecutorAPML{}
			case "chat-track-sidecar":
				payload = &chatTrackSidecarExecutorAPML{}
			default:
				t.Fatalf("unsupported test root %q", tt.rootName)
			}
			err := decodeStrictAPML(tt.raw, tt.rootName, payload)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}
