package runtimeagent

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"strings"
	"testing"
)

// Exercise the public text and audio projection with a trailing private fragment.
func TestAgentRealtimePrivateAfterPublic(t *testing.T) {
	for name, raw := range map[string]string{
		"trailing":          `风从纸边经过。 <invoke name="nimi_self_intention"><parameter name="action">change</parameter></invoke> 后来云散了。`,
		"unclosed-code":     "Hello. ` " + `<invoke name="nimi_self_intention"><parameter name="action">change</parameter></invoke>After.`,
		"message":           `<message intent="reply">Hello.</message>`,
		"qualified-message": `<apml:message intent="reply">Hello.</apml:message>`,
	} {
		t.Run(name, func(t *testing.T) {
			svc, session, _, _ := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend)
			request := session.turn.turn.TurnID

			var streamed strings.Builder
			for _, ch := range raw {
				got, err := svc.projectAgentRealtimeEvent(context.Background(), session, agentRealtimeExecutorStub{}, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_TextOutput{TextOutput: &runtimev1.AiRealtimeTextOutput{RequestId: request, OutputTrackId: "reply", Text: string(ch)}}})
				if err != nil {
					t.Fatal(err)
				}
				streamed.WriteString(got.GetTextOutput().GetText())
			}
			// An unmatched code span becomes definite only at final text.
			// Until then it must not mute a legitimate, still-arriving example.
			if _, err := svc.projectAgentRealtimeEvent(context.Background(), session, agentRealtimeExecutorStub{}, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_TextOutput{TextOutput: &runtimev1.AiRealtimeTextOutput{RequestId: request, OutputTrackId: "reply", Text: raw, Final: true}}}); err != nil {
				t.Fatal(err)
			}
			audio, err := svc.projectAgentRealtimeEvent(context.Background(), session, agentRealtimeExecutorStub{}, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameOutput{RequestId: request, OutputTrackId: "reply", Frame: []byte{1, 2}}}})
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(streamed.String(), "<invoke") || strings.Contains(session.turn.visibleText, "parameter") || strings.Contains(streamed.String(), "<message") || strings.Contains(streamed.String(), "<apml:message") {
				t.Errorf("reserved private fragment reached public projection: %q", streamed.String())
			}
			if audio != nil {
				t.Error("audio still forwarded after complete reserved private marker")
			}
			if err := svc.completeAgentRealtimeTurn(context.Background(), session, nil); err != nil {
				t.Fatal(err)
			}

		})
	}
}

func TestAgentRealtimeTrackDeltasDoNotRepeatConversationSeparators(t *testing.T) {
	svc, session, _, _ := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend)
	request := session.turn.turn.TurnID
	for _, part := range []struct{ track, text string }{{"first", "First reply."}, {"second", "Result reply."}} {
		got, err := svc.projectAgentRealtimeEvent(context.Background(), session, agentRealtimeExecutorStub{}, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_TextOutput{TextOutput: &runtimev1.AiRealtimeTextOutput{RequestId: request, OutputTrackId: part.track, Text: part.text}}})
		if err != nil || got.GetTextOutput().GetText() != part.text {
			t.Fatalf("track delta carried an extra separator: %v %v", got, err)
		}
	}
	if session.turn.visibleText != "First reply.\n\nResult reply." {
		t.Fatalf("canonical tracks lost their separator: %q", session.turn.visibleText)
	}
	svc.failAgentRealtimeTurn(session, runtimev1.ReasonCode_AI_STREAM_BROKEN, "test finished")
}

func TestAgentRealtimeLegitimateCodeChunkBoundary(t *testing.T) {
	for _, raw := range []string{"Example `<action>literal</action>` and continue normally.", "Example `a && b` and continue normally."} {
		for _, mode := range []string{"one_fragment", "per_character"} {
			t.Run(mode+raw, func(t *testing.T) {
				svc, session, _, _ := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend)
				request := session.turn.turn.TurnID
				chunks := []string{raw}
				if mode == "per_character" {
					chunks = nil
					for _, ch := range raw {
						chunks = append(chunks, string(ch))
					}
				}
				var streamed strings.Builder
				for _, chunk := range chunks {
					got, err := svc.projectAgentRealtimeEvent(context.Background(), session, agentRealtimeExecutorStub{}, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_TextOutput{TextOutput: &runtimev1.AiRealtimeTextOutput{RequestId: request, OutputTrackId: "reply", Text: chunk}}})
					if err != nil {
						t.Fatal(err)
					}
					streamed.WriteString(got.GetTextOutput().GetText())
				}
				final, err := svc.projectAgentRealtimeEvent(context.Background(), session, agentRealtimeExecutorStub{}, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_TextOutput{TextOutput: &runtimev1.AiRealtimeTextOutput{RequestId: request, OutputTrackId: "reply", Text: raw, Final: true}}})
				if err != nil || final.GetTextOutput().GetText() != raw {
					t.Fatalf("final text=%q err=%v", final.GetTextOutput().GetText(), err)
				}
				audio, err := svc.projectAgentRealtimeEvent(context.Background(), session, agentRealtimeExecutorStub{}, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameOutput{RequestId: request, OutputTrackId: "reply", Frame: []byte{1, 2}}}})
				if err != nil {
					t.Fatal(err)
				}
				t.Logf("stream=%q canonical=%q muted=%v audioForwarded=%v", streamed.String(), session.turn.visibleText, session.turn.mutedAudio, audio != nil)
				if streamed.String() != raw || session.turn.visibleText != raw {
					t.Error("legitimate code output differs by streaming chunk shape")
				}
				if audio == nil {
					t.Error("legitimate code permanently muted subsequent same-track audio")
				}
				svc.failAgentRealtimeTurn(session, runtimev1.ReasonCode_AI_STREAM_BROKEN, "audit finished")
			})
		}
	}
}
