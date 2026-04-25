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
			name:     "life candidate outside candidates container",
			rootName: "life-turn",
			raw:      `<life-turn><summary>ok</summary><candidate canonical-class="PUBLIC_SHARED"><observational><observation>bad</observation></observational></candidate><canonical-memory-candidates></canonical-memory-candidates></life-turn>`,
			wantErr:  "unsupported <life-turn> context",
		},
		{
			name:     "sidecar text inside container",
			rootName: "chat-track-sidecar",
			raw:      `<chat-track-sidecar><canonical-memory-candidates>bad text</canonical-memory-candidates></chat-track-sidecar>`,
			wantErr:  "text in unsupported <canonical-memory-candidates> context",
		},
		{
			name:     "canonical relation inside truth",
			rootName: "canonical-review",
			raw:      `<canonical-review><summary>bad</summary><narratives></narratives><truths><truth id="truth-1" dimension="relational" normalized-key="k" confidence="0.9"><statement>bad</statement><relation source-id="a" target-id="b" relation-type="thematic" confidence="0.9"/></truth></truths><relations></relations></canonical-review>`,
			wantErr:  "unsupported <truth> context",
		},
		{
			name:     "unknown root attribute",
			rootName: "life-turn",
			raw:      `<life-turn version="1"><summary>ok</summary><canonical-memory-candidates></canonical-memory-candidates></life-turn>`,
			wantErr:  "unsupported version attribute",
		},
		{
			name:     "duplicate action attribute",
			rootName: "chat-track-sidecar",
			raw:      `<chat-track-sidecar><next-hook-intent trigger-family="TIME" trigger-family="EVENT" effect="FOLLOW_UP_TURN"><time delay="60s"/></next-hook-intent><canonical-memory-candidates></canonical-memory-candidates></chat-track-sidecar>`,
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
			case "canonical-review":
				payload = &canonicalReviewExecutorAPML{}
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
