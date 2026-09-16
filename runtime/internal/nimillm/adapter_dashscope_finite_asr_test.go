package nimillm

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"golang.org/x/net/websocket"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestDashScopeFiniteASRUsesActualFinalWordsAndTerminal(t *testing.T) {
	audio := finiteASRTestWAV()
	server := finiteASRTestServer(t, audio, func(conn *websocket.Conn, taskID string) {
		finiteASRSendEvent(t, conn, taskID, "result-generated", map[string]any{"sentence_id": 1, "sentence_end": false, "text": "wrong interim"})
		final := finiteASRFinalSentence()
		// Provider token boundaries may contain a separator. It is not a
		// lexical alignment unit, and its removal must not retime actual words.
		words := final["words"].([]any)
		final["words"] = []any{words[0], map[string]any{"text": " ", "punctuation": "", "begin_time": 295, "end_time": 503}, words[1]}
		finiteASRSendEvent(t, conn, taskID, "result-generated", final)
		finiteASRSendEvent(t, conn, taskID, "task-finished", nil)
	})
	defer server.Close()
	artifacts, usage, _, err := executeDashScopeFiniteASR(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, finiteASRTestRequest(audio), "qwen-audio-3.0-asr-flash-streaming")
	if err != nil || len(artifacts) != 1 || usage == nil {
		t.Fatalf("finite ASR result=%v usage=%v error=%v", artifacts, usage, err)
	}
	var transcript runtimev1.SpeechTranscript
	if artifacts[0].GetMimeType() != localexecution.SpeechTranscriptMIME || protojson.Unmarshal(artifacts[0].GetBytes(), &transcript) != nil {
		t.Fatalf("typed transcription missing: %v", artifacts[0])
	}
	if transcript.Text != "Hello, world." || transcript.Language != "" || len(transcript.Words) != 2 ||
		transcript.Words[0].Text != "Hello," || transcript.Words[0].StartSeconds != 0.17 || transcript.Words[0].EndSeconds != 0.295 ||
		transcript.Words[1].StartSeconds != 0.503 || transcript.Words[1].EndSeconds != 0.92 {
		t.Fatalf("actual alignment/punctuation/language changed: %+v", &transcript)
	}
}

func TestDashScopeFiniteASRRejectsIncompleteOrContradictoryResults(t *testing.T) {
	for _, name := range []string{"missing-terminal", "wrong-task", "missing-words", "duplicate-final", "empty-final", "unfinished-sentence", "missing-time", "backward-time", "empty-completion"} {
		t.Run(name, func(t *testing.T) {
			audio := finiteASRTestWAV()
			server := finiteASRTestServer(t, audio, func(conn *websocket.Conn, taskID string) {
				if name == "wrong-task" {
					taskID = "another-task"
				}
				final := finiteASRFinalSentence()
				if name == "empty-final" {
					final["text"] = ""
					final["words"] = []any{}
				}
				if name == "missing-words" {
					delete(final, "words")
				}
				if name == "missing-time" {
					delete(final["words"].([]any)[0].(map[string]any), "begin_time")
				}
				if name == "backward-time" {
					final["words"].([]any)[1].(map[string]any)["begin_time"] = -1
				}
				if name != "empty-completion" {
					finiteASRSendEvent(t, conn, taskID, "result-generated", final)
				}
				if name == "duplicate-final" {
					finiteASRSendEvent(t, conn, taskID, "result-generated", final)
				}
				if name == "unfinished-sentence" {
					finiteASRSendEvent(t, conn, taskID, "result-generated", map[string]any{"sentence_id": 2, "sentence_end": false, "text": "unfinished words"})
				}
				if name != "missing-terminal" {
					finiteASRSendEvent(t, conn, taskID, "task-finished", nil)
				}
			})
			defer server.Close()
			_, _, _, err := executeDashScopeFiniteASR(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, finiteASRTestRequest(audio), "qwen-audio-3.0-asr-flash-streaming")
			want := runtimev1.ReasonCode_AI_OUTPUT_INVALID
			if name == "missing-terminal" {
				want = runtimev1.ReasonCode_AI_STREAM_BROKEN
			}
			if got, ok := grpcerr.ExtractReasonCode(err); !ok || got != want {
				t.Fatalf("error=%v reason=%v want=%v", err, got, want)
			}
			if name == "duplicate-final" || name == "empty-final" {
				stage := "non_increasing_final_sentence"
				if name == "empty-final" {
					stage = "empty_final_sentence"
				}
				metadata, _ := grpcerr.ExtractReasonMetadata(err)
				if metadata["action_hint"] != "inspect_dashscope_asr_"+stage {
					t.Fatalf("final result failure lost its content-free cause: %v", metadata)
				}
			}
		})
	}
}

func TestDashScopeFiniteASRCancellationClosesProviderConnection(t *testing.T) {
	audio := finiteASRTestWAV()
	entered := make(chan struct{})
	disconnected := make(chan struct{})
	server := finiteASRTestServer(t, audio, func(conn *websocket.Conn, _ string) {
		close(entered)
		var raw []byte
		_ = websocket.Message.Receive(conn, &raw)
		close(disconnected)
	})
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, _, _, err := executeDashScopeFiniteASR(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, finiteASRTestRequest(audio), "qwen-audio-3.0-asr-flash-streaming")
		done <- err
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("provider did not receive finite input")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation lost: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled request did not end")
	}
	select {
	case <-disconnected:
	case <-time.After(time.Second):
		t.Fatal("provider connection remained active after cancellation")
	}
}

func TestDashScopeFiniteASRValidatesActualWAV(t *testing.T) {
	for _, mutation := range []func([]byte){
		func(audio []byte) { audio[22] = 2 },
		func(audio []byte) { audio[4] = 0 },
		func(audio []byte) { audio[32] = 0 },
		func(audio []byte) { audio[20] = 3 },
	} {
		audio := finiteASRTestWAV()
		mutation(audio)
		if _, _, err := finiteASRWAVInfo(audio); err == nil {
			t.Fatal("invalid/unsupported WAV was accepted")
		}
	}
}

func finiteASRTestServer(t *testing.T, expected []byte, respond func(*websocket.Conn, string)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(websocket.Handler(func(conn *websocket.Conn) {
		defer func() { _ = conn.Close() }()
		var start map[string]any
		if err := websocket.JSON.Receive(conn, &start); err != nil {
			t.Error(err)
			return
		}
		taskID := ValueAsString(MapField(start["header"], "task_id"))
		params := MapField(start["payload"], "parameters").(map[string]any)
		if ValueAsString(MapField(start["header"], "action")) != "run-task" || len(taskID) != 36 || params["format"] != "wav" || ValueAsInt64(params["sample_rate"]) != 24000 {
			t.Errorf("invalid captured protocol request: %v", start)
		}
		finiteASRSendEvent(t, conn, taskID, "task-started", nil)
		var received []byte
		for {
			var raw []byte
			if err := websocket.Message.Receive(conn, &raw); err != nil {
				t.Error(err)
				return
			}
			var finish map[string]any
			if json.Unmarshal(raw, &finish) == nil {
				if ValueAsString(MapField(finish["header"], "action")) != "finish-task" || ValueAsString(MapField(finish["header"], "task_id")) != taskID {
					t.Errorf("invalid finish: %v", finish)
				}
				break
			}
			received = append(received, raw...)
		}
		if !bytes.Equal(received, expected) {
			t.Error("input audio was changed or truncated")
		}
		respond(conn, taskID)
	}))
}

func finiteASRSendEvent(t *testing.T, conn *websocket.Conn, taskID, event string, sentence map[string]any) {
	t.Helper()
	payload := map[string]any{}
	if sentence != nil {
		payload = map[string]any{"output": map[string]any{"sentence": sentence}, "usage": map[string]any{"duration": 3}}
	}
	// A deliberately invalid result may make the client close before later
	// fixture frames. The actual invocation must still fail with its typed reason.
	_ = websocket.JSON.Send(conn, map[string]any{"header": map[string]any{"event": event, "task_id": taskID}, "payload": payload})
}

func finiteASRFinalSentence() map[string]any {
	return map[string]any{"sentence_id": 1, "sentence_end": true, "text": "Hello, world.", "words": []any{
		map[string]any{"text": "Hello", "punctuation": ",", "begin_time": 170, "end_time": 295},
		map[string]any{"text": "world", "punctuation": ".", "begin_time": 503, "end_time": 920},
	}}
}

func finiteASRTestRequest(audio []byte) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
			Language: "en", MimeType: "audio/wav", Timestamps: proto.Bool(true),
			AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: audio}},
		}}}}
}

func finiteASRTestWAV() []byte {
	audio := make([]byte, 44+24000*2*3)
	copy(audio[:4], "RIFF")
	binary.LittleEndian.PutUint32(audio[4:8], uint32(len(audio)-8))
	copy(audio[8:12], "WAVE")
	copy(audio[12:16], "fmt ")
	binary.LittleEndian.PutUint32(audio[16:20], 16)
	binary.LittleEndian.PutUint16(audio[20:22], 1)
	binary.LittleEndian.PutUint16(audio[22:24], 1)
	binary.LittleEndian.PutUint32(audio[24:28], 24000)
	binary.LittleEndian.PutUint32(audio[28:32], 48000)
	binary.LittleEndian.PutUint16(audio[32:34], 2)
	binary.LittleEndian.PutUint16(audio[34:36], 16)
	copy(audio[36:40], "data")
	binary.LittleEndian.PutUint32(audio[40:44], uint32(len(audio)-44))
	return audio
}
