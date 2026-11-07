package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/proto"
)

// Upstream transport is a fixture. Production endpoint validation requires
// trusted HTTPS; its existing security tests cover that separate boundary.
// This test exercises production catalog/credential capture, native Driver,
// admission, input/output, stop receipts and closure over a fixture WebSocket.
type xaiRealtimeFixtureHost struct {
	t        *testing.T
	endpoint string
}
type xaiRealtimeFixtureSession struct {
	conn   *websocket.Conn
	events chan []byte
	errors chan error
	once   sync.Once
	done   chan struct{}
}

func (h xaiRealtimeFixtureHost) Open(ctx context.Context, account string, record connector.ConnectorRecord, secret string, target remoteexecution.RealtimeProviderTarget, transport capabilitydriver.CloudRealtimeTransport) (remoteexecution.RealtimeSession, error) {
	if account != "user-001" || record.Provider != "xai" || record.Endpoint != "https://xai-fixture.example/gateway/v1" || secret != "test-key" || target.ProviderModelID() != capabilitydriver.XAIVoice3Model || transport.Path != "/v1/realtime" || !transport.ModelQuery {
		h.t.Fatal("captured target or custody changed")
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, strings.Replace(h.endpoint, "http://", "ws://", 1)+"/gateway/v1/realtime?model=grok-voice-3.0", http.Header{"Authorization": []string{"Bearer " + secret}})
	if err != nil {
		return nil, err
	}
	s := &xaiRealtimeFixtureSession{conn: conn, events: make(chan []byte, 32), errors: make(chan error, 1), done: make(chan struct{})}
	go func() {
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				select {
				case <-s.done:
					return
				default:
					s.errors <- err
					return
				}
			}
			select {
			case s.events <- raw:
			case <-s.done:
				return
			}
		}
	}()
	return s, nil
}
func (s *xaiRealtimeFixtureSession) Send(ctx context.Context, raw []byte) error {
	return s.conn.WriteMessage(websocket.TextMessage, raw)
}
func (s *xaiRealtimeFixtureSession) Events() <-chan []byte { return s.events }
func (s *xaiRealtimeFixtureSession) Errors() <-chan error  { return s.errors }
func (s *xaiRealtimeFixtureSession) Close() error {
	s.once.Do(func() { close(s.done); _ = s.conn.Close() })
	return nil
}

func TestXAIVoice3ManagedSessionTransportAndLifecycle(t *testing.T) {
	var connects, creates atomic.Int32
	closed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connects.Add(1)
		if r.URL.Path != "/gateway/v1/realtime" || r.URL.Query().Get("model") != capabilitydriver.XAIVoice3Model || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("OpenAI-Beta") != "" {
			t.Error("captured native transport", r.URL.Path)
		}
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		defer close(closed)
		send := func(raw string) {
			if err := conn.WriteMessage(websocket.TextMessage, []byte(raw)); err != nil {
				t.Error(err)
			}
		}
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var b map[string]any
			if err := json.Unmarshal(raw, &b); err != nil {
				t.Error(err)
				return
			}
			switch b["type"] {
			case "session.update":
				s := b["session"].(map[string]any)
				if s["model"] != capabilitydriver.XAIVoice3Model || s["voice"] != "eve" || s["turn_detection"].(map[string]any)["type"] != nil || s["resumption"].(map[string]any)["enabled"] != false || len(s["tools"].([]any)) != 0 {
					t.Error("native session settings")
				}
				send(`{"type":"conversation.created","conversation":{"id":"private-conversation"}}`)
				send(`{"type":"session.updated","session":{"model":"grok-voice-3.0","voice":"eve","instructions":"Speak clearly.","turn_detection":{"type":null},"tools":[]}}`)
			case "input_audio_buffer.append":
				audio, err := base64.StdEncoding.DecodeString(b["audio"].(string))
				if err != nil || len(audio) != 960 {
					t.Error("negotiated audio frame changed")
				}
			case "input_audio_buffer.commit":
				send(`{"type":"input_audio_buffer.committed","item_id":"native-input"}`)
				send(`{"type":"conversation.item.input_audio_transcription.updated","item_id":"native-input","transcript":"Hel"}`)
				send(`{"type":"conversation.item.input_audio_transcription.updated","item_id":"native-input","transcript":"Hello"}`)
				send(`{"type":"conversation.item.input_audio_transcription.completed","item_id":"native-input","transcript":"Hello."}`)
			case "response.create":
				id := fmt.Sprintf("r%d", creates.Add(1))
				response := b["response"].(map[string]any)
				if len(response["modalities"].([]any)) != 2 {
					t.Error("audio output omitted")
				}
				send(fmt.Sprintf(`{"type":"response.created","response":{"id":"%s","status":"in_progress"}}`, id))
				send(fmt.Sprintf(`{"type":"response.output_audio.delta","response_id":"%s","delta":"AQACAA=="}`, id))
				if id == "r2" {
					send(`{"type":"response.output_audio_transcript.done","response_id":"r2","transcript":"A new answer."}`)
					send(`{"type":"response.output_audio.done","response_id":"r2"}`)
					send(`{"type":"response.done","response":{"id":"r2","status":"completed","usage":{"input_tokens":4,"output_tokens":6}}}`)
				}
			case "response.cancel":
				if b["response_id"] != "r1" {
					t.Error("cancel switched native response")
				}
				send(`{"type":"response.output_audio.delta","response_id":"r1","delta":"AQACAA=="}`)
				send(`{"type":"response.done","response":{"id":"r1","status":"cancelled","usage":{"input_tokens":2,"output_tokens":1}}}`)
			default:
				t.Error("unexpected business wire", b["type"])
			}
		}
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "xai", capabilitydriver.XAIVoice3Model, "https://xai-fixture.example/gateway/v1", Config{})
	f.service.remoteRealtimeHost = xaiRealtimeFixtureHost{t: t, endpoint: server.URL}
	intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
	intent.CapabilityContract = "realtime.interact"
	intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.realtime.interact.xai", DriverId: "nimi.runtime.driver.xai", DriverDialect: "xai/realtime/v1"}
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("nimi.desktop", intent)); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(f.context, 10*time.Second)
	defer cancel()
	req := &runtimev1.OpenRealtimeSessionRequest{InputAudio: &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: 16000, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: 640}, AudioOutputEnabled: true, TurnDetection: runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL, InitialInstruction: "Speak clearly."}
	bad := proto.Clone(req).(*runtimev1.OpenRealtimeSessionRequest)
	bad.TurnDetection = runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD
	if _, err := f.service.OpenRealtimeSession(ctx, bad); err == nil || connects.Load() != 0 {
		t.Fatal("automatic VAD opened", err)
	}
	open, err := f.service.OpenRealtimeSession(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if open.GetNegotiatedInputAudio().GetSampleRateHz() != 24000 || open.GetNegotiatedInputAudio().GetMaximumFrameBytes() != 960 {
		t.Fatal("negotiation", open)
	}
	id, generation := open.GetRealtimeSessionId(), open.GetControl().GetGeneration()
	closeRequest := &runtimev1.CloseRealtimeSessionRequest{RealtimeSessionId: id, Generation: generation}
	defer f.service.CloseRealtimeSession(context.WithoutCancel(f.context), closeRequest)
	record, ok := f.service.realtimeSessions.get(id)
	if !ok {
		t.Fatal("session not retained")
	}
	events, release, err := record.stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	next := func(predicate func(*runtimev1.AiRealtimeEvent) bool) *runtimev1.AiRealtimeEvent {
		t.Helper()
		for {
			select {
			case e, ok := <-events:
				if !ok {
					t.Fatal("early session terminal")
				}
				if e.GetFailure() != nil {
					t.Fatal(e)
				}
				if predicate(e) {
					return e
				}
			case <-ctx.Done():
				t.Fatal("event timeout", ctx.Err())
			}
		}
	}
	if _, err := f.service.AppendRealtimeInput(ctx, &runtimev1.AppendRealtimeInputRequest{RealtimeSessionId: id, Generation: generation, Input: &runtimev1.AppendRealtimeInputRequest_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameInput{InputTrackId: "mic", UtteranceId: "u1", FrameSequence: 1, Frame: make([]byte, 960)}}}); err != nil {
		t.Fatal(err)
	}
	control := func(requestID string, control runtimev1.AiRealtimeOwnerControlKind) {
		t.Helper()
		if _, err := f.service.SubmitRealtimeOwnerControl(ctx, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: id, Generation: generation, RequestId: requestID, Control: control}); err != nil {
			t.Fatal(err)
		}
	}
	control("commit", runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT)
	final := next(func(e *runtimev1.AiRealtimeEvent) bool { return e.GetTranscript().GetFinal() })
	if final.GetTranscript().GetText() != "Hello." || final.GetTranscript().GetInputTrackId() != "mic" {
		t.Fatal("native input identity", final)
	}
	control("first", runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE)
	first := next(func(e *runtimev1.AiRealtimeEvent) bool { return e.GetAudioFrame() != nil })
	if _, err := f.service.InterruptRealtimeOutput(ctx, &runtimev1.InterruptRealtimeOutputRequest{RealtimeSessionId: id, Generation: generation, OutputTrackId: first.GetAudioFrame().GetOutputTrackId()}); err != nil {
		t.Fatal(err)
	}
	interrupted := next(func(e *runtimev1.AiRealtimeEvent) bool {
		return e.GetOutputTrack().GetLifecycle() == runtimev1.AiRealtimeOutputTrackLifecycle_AI_REALTIME_OUTPUT_TRACK_LIFECYCLE_INTERRUPTED
	})
	if interrupted.GetOutputTrack().GetOutputTrackId() != first.GetAudioFrame().GetOutputTrackId() {
		t.Fatal("cancel changed output", interrupted)
	}
	control("second", runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE)
	terminal := next(func(e *runtimev1.AiRealtimeEvent) bool { return e.GetRequestTerminal() != nil })
	if terminal.GetRequestTerminal().GetRequestId() != "second" {
		t.Fatal("cancel fabricated success", terminal)
	}
	closeResult, err := f.service.CloseRealtimeSession(ctx, closeRequest)
	if err != nil || !closeResult.GetClosure().GetLocalResourcesReleased() || closeResult.GetClosure().GetProviderSessionClosed() || closeResult.GetUsage() != nil {
		t.Fatal("closure evidence", closeResult, err)
	}
	select {
	case <-closed:
	case <-ctx.Done():
		t.Fatal("native transport retained")
	}
	if connects.Load() != 1 || creates.Load() != 2 {
		t.Fatal("unexpected reconnect or generation", connects.Load(), creates.Load())
	}
}
