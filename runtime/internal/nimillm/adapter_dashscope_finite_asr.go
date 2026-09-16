package nimillm

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"golang.org/x/net/websocket"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
// This consumes a finite audio.transcribe Job. The private provider transport
// is duplex; it does not expose or simulate a public realtime session.
func executeDashScopeFiniteASR(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	spec := scenarioSpeechTranscribeSpec(req)
	if spec == nil {
		return nil, nil, "", finiteASRInvalidInput()
	}
	audio, _, _, err := ResolveTranscriptionAudioSource(ctx, spec)
	if err != nil {
		return nil, nil, "", err
	}
	sampleRate, duration, err := finiteASRWAVInfo(audio)
	if err != nil {
		return nil, nil, "", err
	}
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	targetURL := resolveDashScopeRealtimeTTSWebSocketURL(cfg.BaseURL)
	if err := validateDashScopeRealtimeTTSWebSocketURL(ctx, targetURL, cfg.AllowLoopbackEndpoint); err != nil {
		return nil, nil, "", err
	}
	config, err := websocket.NewConfig(targetURL, websocketOrigin(targetURL))
	if err != nil {
		return nil, nil, "", finiteASRInvalidInput()
	}
	config.Header = http.Header{}
	for name, value := range cfg.Headers {
		if allowProviderRequestHeader(name) {
			config.Header.Set(name, value)
		}
	}
	config.Header.Set("Authorization", "Bearer "+key)
	ctx, cancel := context.WithTimeout(ctx, time.Duration(duration*float64(time.Second))+90*time.Second)
	defer cancel()
	connection, err := config.DialContext(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return nil, nil, "", ctx.Err()
		}
		return nil, nil, "", MapProviderRequestError(err)
	}
	defer func() { _ = connection.Close() }()
	connection.MaxPayloadBytes = localexecution.MaxSpeechTranscriptBytes + 65536
	if deadline, ok := ctx.Deadline(); ok {
		_ = connection.SetDeadline(deadline)
	}
	stopClose := context.AfterFunc(ctx, func() { _ = connection.Close() })
	defer stopClose()
	var uuid [16]byte
	if _, err := rand.Read(uuid[:]); err != nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	uuid[6] = uuid[6]&0x0f | 0x40
	uuid[8] = uuid[8]&0x3f | 0x80
	taskID := fmt.Sprintf("%x-%x-%x-%x-%x", uuid[:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:])
	parameters := map[string]any{"format": "wav", "sample_rate": sampleRate}
	if spec.GetLanguage() != "" {
		parameters["language_hints"] = []string{spec.GetLanguage()}
	}
	start := map[string]any{
		"header":  map[string]any{"action": "run-task", "task_id": taskID, "streaming": "duplex"},
		"payload": map[string]any{"task_group": "audio", "task": "asr", "function": "recognition", "model": model, "parameters": parameters, "input": map[string]any{}},
	}
	startedAt := time.Now()
	if err := websocket.JSON.Send(connection, start); err != nil {
		return nil, nil, "", finiteASRTransportError(ctx, err)
	}
	first, err := readFiniteASREvent(ctx, connection, taskID)
	if err != nil {
		return nil, nil, "", err
	}
	if first.Header.Event != "task-started" {
		return nil, nil, "", finiteASRInvalidOutput("expected task-started")
	}
	// Read results while sending so long inputs cannot deadlock against the
	// provider's result frames filling the opposite side of the connection.
	var finishRequested atomic.Bool
	sendResult := make(chan error, 1)
	sendDone := make(chan struct{})
	go func() {
		defer close(sendDone)
		err := sendFiniteASRAudio(connection, audio, taskID, &finishRequested)
		sendResult <- err
		if err != nil {
			_ = connection.Close()
		}
	}()
	defer func() { _ = connection.Close(); <-sendDone }()
	result := &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED}
	var sentences []string
	var textBytes int
	lastFinalID := int64(-1)
	pending := map[int64]bool{}
	var billedSeconds int64
	for {
		event, err := readFiniteASREvent(ctx, connection, taskID)
		if err != nil {
			return nil, nil, "", err
		}
		switch event.Header.Event {
		case "result-generated":
			sentence := event.Payload.Output.Sentence
			if sentence == nil {
				return nil, nil, "", finiteASRInvalidOutput("result omitted sentence")
			}
			if sentence.Heartbeat {
				continue
			}
			if sentence.ID == nil || *sentence.ID < 0 || sentence.Final == nil {
				return nil, nil, "", finiteASRInvalidOutput(fmt.Sprintf("invalid sentence flags (identity present=%t, terminal flag present=%t)", sentence.ID != nil, sentence.Final != nil))
			}
			if !*sentence.Final {
				if strings.TrimSpace(sentence.Text) != "" {
					pending[*sentence.ID] = true
					if len(pending) > localexecution.MaxSpeechTranscriptWords {
						return nil, nil, "", finiteASRInvalidOutput("too many unfinished sentences")
					}
				}
				continue
			}
			if *sentence.ID <= lastFinalID {
				return nil, nil, "", finiteASRInvalidOutput("non increasing final sentence")
			}
			if strings.TrimSpace(sentence.Text) == "" {
				return nil, nil, "", finiteASRInvalidOutput("empty final sentence")
			}
			lastFinalID = *sentence.ID
			delete(pending, *sentence.ID)
			textBytes += len(sentence.Text) + 1
			if textBytes > localexecution.MaxSpeechTranscriptBytes || len(result.Words)+len(sentence.Words) > localexecution.MaxSpeechTranscriptWords {
				return nil, nil, "", finiteASRInvalidOutput("transcript exceeds output bounds")
			}
			sentences = append(sentences, sentence.Text)
			if spec.GetTimestamps() && len(sentence.Words) == 0 {
				return nil, nil, "", finiteASRInvalidOutput("final sentence omitted requested word timings")
			}
			for _, word := range sentence.Words {
				wordText := word.Text + word.Punctuation
				// Keep the provider's full sentence text, but separators alone are
				// not words in the canonical alignment result. Never estimate or
				// shift the timestamps of the remaining lexical units.
				if strings.TrimSpace(wordText) == "" {
					continue
				}
				if word.Begin == nil || word.End == nil {
					return nil, nil, "", finiteASRInvalidOutput("word omitted timing")
				}
				if *word.Begin < 0 || *word.End < *word.Begin {
					return nil, nil, "", finiteASRInvalidOutput(fmt.Sprintf("invalid_word_time_i_%d_start_%d_end_%d", len(result.Words), *word.Begin, *word.End))
				}
				if len(result.Words) > 0 && float64(*word.Begin)/1000 < result.Words[len(result.Words)-1].StartSeconds {
					return nil, nil, "", finiteASRInvalidOutput(fmt.Sprintf("backward_word_time_i_%d_start_%d_previous_%d", len(result.Words), *word.Begin, int64(result.Words[len(result.Words)-1].StartSeconds*1000)))
				}
				result.Words = append(result.Words, &runtimev1.SpeechTranscriptWord{
					Text: wordText, StartSeconds: float64(*word.Begin) / 1000, EndSeconds: float64(*word.End) / 1000,
				})
			}
			if event.Payload.Usage != nil && event.Payload.Usage.Duration > billedSeconds {
				billedSeconds = event.Payload.Usage.Duration
			}
		case "task-finished":
			if !finishRequested.Load() || len(pending) != 0 {
				return nil, nil, "", finiteASRInvalidOutput("task finished before input completion or with unfinished sentences")
			}
			<-sendDone
			if err := <-sendResult; err != nil {
				return nil, nil, "", finiteASRTransportError(ctx, err)
			}
			result.Text = strings.TrimSpace(strings.Join(sentences, "\n"))
			// The provider does not report detected language or an explicit
			// no_speech result here. Never invent either from caller hints/EOF.
			if err := localexecution.ValidateSpeechTranscript(result, spec.GetTimestamps()); err != nil {
				return nil, nil, "", finiteASRInvalidOutput(err.Error())
			}
			body, err := protojson.Marshal(result)
			if err != nil {
				return nil, nil, "", finiteASRInvalidOutput("transcript encoding failed")
			}
			artifact := BinaryArtifact(localexecution.SpeechTranscriptMIME, body, map[string]any{"provider_usage_seconds": billedSeconds})
			return []*runtimev1.ScenarioArtifact{artifact}, &runtimev1.UsageStats{ComputeMs: time.Since(startedAt).Milliseconds()}, "", nil
		default:
			return nil, nil, "", finiteASRInvalidOutput("unexpected task event")
		}
	}
}

type finiteASREvent struct {
	Header struct {
		TaskID       string `json:"task_id"`
		Event        string `json:"event"`
		ErrorCode    string `json:"error_code"`
		ErrorMessage string `json:"error_message"`
	} `json:"header"`
	Payload struct {
		Output struct {
			Sentence *struct {
				ID        *int64 `json:"sentence_id"`
				Text      string `json:"text"`
				Final     *bool  `json:"sentence_end"`
				Heartbeat bool   `json:"heartbeat"`
				Words     []struct {
					Text        string `json:"text"`
					Punctuation string `json:"punctuation"`
					Begin       *int64 `json:"begin_time"`
					End         *int64 `json:"end_time"`
				} `json:"words"`
			} `json:"sentence"`
		} `json:"output"`
		Usage *struct {
			Duration int64 `json:"duration"`
		} `json:"usage"`
	} `json:"payload"`
}

func readFiniteASREvent(ctx context.Context, connection *websocket.Conn, taskID string) (finiteASREvent, error) {
	var value finiteASREvent
	var raw []byte
	if err := websocket.Message.Receive(connection, &raw); err != nil {
		return value, finiteASRTransportError(ctx, err)
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return value, finiteASRInvalidOutput("event does not match the declared JSON schema: " + err.Error())
	}
	if value.Header.TaskID != taskID {
		return value, finiteASRInvalidOutput("event task identity does not match")
	}
	if value.Header.Event == "task-failed" {
		return value, dashScopeRealtimeTTSError(map[string]any{"error_code": value.Header.ErrorCode, "error_message": value.Header.ErrorMessage})
	}
	return value, nil
}

func sendFiniteASRAudio(connection *websocket.Conn, audio []byte, taskID string, finish *atomic.Bool) error {
	for offset := 0; offset < len(audio); offset += 32 * 1024 {
		end := min(offset+32*1024, len(audio))
		if err := websocket.Message.Send(connection, audio[offset:end]); err != nil {
			return err
		}
	}
	finish.Store(true)
	return websocket.JSON.Send(connection, dashScopeRealtimeTTSFinishTaskPayload(taskID))
}

func finiteASRWAVInfo(audio []byte) (uint32, float64, error) {
	if len(audio) < 44 || len(audio) > 32*1024*1024 || string(audio[:4]) != "RIFF" || string(audio[8:12]) != "WAVE" || uint64(binary.LittleEndian.Uint32(audio[4:8]))+8 != uint64(len(audio)) {
		return 0, 0, finiteASRInvalidInput()
	}
	var rate uint32
	var align uint16
	var dataSize int
	hasFormat := false
	for offset := 12; offset < len(audio); {
		if offset+8 > len(audio) {
			return 0, 0, finiteASRInvalidInput()
		}
		size := int(binary.LittleEndian.Uint32(audio[offset+4 : offset+8]))
		start := offset + 8
		if size > len(audio)-start {
			return 0, 0, finiteASRInvalidInput()
		}
		switch string(audio[offset : offset+4]) {
		case "fmt ":
			if hasFormat || size < 16 {
				return 0, 0, finiteASRInvalidInput()
			}
			hasFormat = true
			format := binary.LittleEndian.Uint16(audio[start : start+2])
			channels := binary.LittleEndian.Uint16(audio[start+2 : start+4])
			rate = binary.LittleEndian.Uint32(audio[start+4 : start+8])
			align = binary.LittleEndian.Uint16(audio[start+12 : start+14])
			bits := binary.LittleEndian.Uint16(audio[start+14 : start+16])
			if format != 1 || channels != 1 || rate == 0 || (bits != 8 && bits != 16 && bits != 24 && bits != 32) || align != bits/8 || uint64(binary.LittleEndian.Uint32(audio[start+8:start+12])) != uint64(rate)*uint64(align) {
				return 0, 0, finiteASRInvalidInput()
			}
		case "data":
			if dataSize != 0 || size == 0 {
				return 0, 0, finiteASRInvalidInput()
			}
			dataSize = size
		}
		offset = start + size + size%2
		if offset > len(audio) {
			return 0, 0, finiteASRInvalidInput()
		}
	}
	if !hasFormat || dataSize == 0 || dataSize%int(align) != 0 {
		return 0, 0, finiteASRInvalidInput()
	}
	duration := float64(dataSize) / (float64(rate) * float64(align))
	if duration > 300 {
		return 0, 0, finiteASRInvalidInput()
	}
	return rate, duration, nil
}

func finiteASRTransportError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_STREAM_BROKEN, err, grpcerr.ReasonOptions{Message: "finite transcription transport ended before successful completion"})
}

func finiteASRInvalidInput() error {
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "finite transcription requires a nonempty mono PCM WAV of at most 300 seconds and 32 MiB"})
}

func finiteASRInvalidOutput(detail string) error {
	// Job failure text is intentionally canonical. Keep a bounded, content-free
	// stage in the existing action hint so diagnosis survives that projection.
	stage := strings.TrimSpace(strings.Split(strings.Split(detail, ":")[0], "(")[0])
	stage = strings.ReplaceAll(strings.ReplaceAll(strings.ToLower(stage), " ", "_"), "-", "_")
	return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, grpcerr.ReasonOptions{
		Message:    "DashScope transcription: " + detail,
		ActionHint: "inspect_dashscope_asr_" + stage,
	})
}
