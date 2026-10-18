package runtimeagent

import (
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
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

func TestHookPublicPurposeIsOptionalDisplayText(t *testing.T) {
	for _, tc := range []struct{ name, attr, want string }{
		{"present", ` public-purpose="  稍后回顾观察  "`, "稍后回顾观察"},
		{"absent", "", ""},
		{"blank", ` public-purpose=" "`, ""},
		{"unicode boundary", ` public-purpose="` + strings.Repeat("观", 160) + `"`, strings.Repeat("观", 160)},
		{"overlong", ` public-purpose="` + strings.Repeat("观", 161) + `"`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := `<life-turn><summary>unchanged</summary><next-hook-intent trigger-family="TIME" effect="FOLLOW_UP_TURN" reason="private instruction"` + tc.attr + `><time delay="600s"/></next-hook-intent></life-turn>`
			var payload lifeTurnExecutorAPML
			if err := decodeStrictAPML(raw, "life-turn", &payload); err != nil {
				t.Fatal(err)
			}
			intent, err := apmlHookIntentValue(payload.NextHookIntent)
			if err != nil {
				t.Fatal(err)
			}
			pending, err := normalizePendingHook(&runtimev1.PendingHook{Intent: intent}, time.Now())
			if err != nil {
				t.Fatalf("optional purpose blocked admission: %v", err)
			}
			// The original owner persists protobuf JSON; verify the new field survives it.
			encoded, err := protojson.Marshal(pending)
			if err != nil {
				t.Fatal(err)
			}
			restored := &runtimev1.PendingHook{}
			if err := protojson.Unmarshal(encoded, restored); err != nil {
				t.Fatal(err)
			}
			restored.Revision = 1
			projected := projectLocalAppPendingHook(restored)
			if projected.PublicPurpose != tc.want || !projected.CanModify || projected.SystemCadence {
				t.Fatalf("projection=%+v", projected)
			}
			if restored.Intent.Reason != "private instruction" || restored.Intent.TriggerDetail.GetTime().Delay.AsDuration() != 10*time.Minute {
				t.Fatal("display text changed execution inputs")
			}
			public, err := protojson.Marshal(projected)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(public), "private instruction") {
				t.Fatal("private reason leaked")
			}
		})
	}
}
