package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
)

func cosyVoiceWAVForTest(streaming, extraChunks bool) ([]byte, int) {
	chunk := func(id string, data []byte) []byte {
		b := make([]byte, 8+len(data)+len(data)%2)
		copy(b, id)
		binary.LittleEndian.PutUint32(b[4:8], uint32(len(data)))
		copy(b[8:], data)
		return b
	}
	fmtPCM := make([]byte, 16)
	binary.LittleEndian.PutUint16(fmtPCM, 1)
	binary.LittleEndian.PutUint16(fmtPCM[2:], 1)
	binary.LittleEndian.PutUint32(fmtPCM[4:], 24000)
	binary.LittleEndian.PutUint32(fmtPCM[8:], 48000)
	binary.LittleEndian.PutUint16(fmtPCM[12:], 2)
	binary.LittleEndian.PutUint16(fmtPCM[14:], 16)
	b := append([]byte("RIFF\x00\x00\x00\x00WAVE"), chunk("fmt ", fmtPCM)...)
	if extraChunks {
		b = append(b, chunk("JUNK", []byte{1, 2, 3})...)
	}
	dataOffset := len(b)
	pcm := make([]byte, 60000)
	for i := 0; i < len(pcm); i++ {
		pcm[i] = byte(i * 7)
	}
	b = append(b, chunk("data", pcm)...)
	binary.LittleEndian.PutUint32(b[4:8], uint32(len(b)-8))
	if streaming {
		binary.LittleEndian.PutUint32(b[4:8], dashScopeStreamingWAVDataSize+uint32(dataOffset))
		binary.LittleEndian.PutUint32(b[dataOffset+4:dataOffset+8], dashScopeStreamingWAVDataSize)
	} else if extraChunks {
		b = append(b, chunk("LIST", []byte("INFO"))...)
		binary.LittleEndian.PutUint32(b[4:8], uint32(len(b)-8))
	}
	return b, dataOffset
}

func TestCosyVoiceWAVFinalizesOnlyKnownStreamingLengths(t *testing.T) {
	for _, extra := range []bool{false, true} {
		input, offset := cosyVoiceWAVForTest(true, extra)
		original := append([]byte(nil), input...)
		result, err := finishCompletedDashScopeWAV(input)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(input, original) {
			t.Fatal("source bytes mutated")
		}
		if int(binary.LittleEndian.Uint32(result[4:8]))+8 != len(result) || int(binary.LittleEndian.Uint32(result[offset+4:offset+8])) != len(result)-offset-8 {
			t.Fatal("finite lengths differ from actual bytes")
		}
		for i := range result {
			if i >= 4 && i < 8 || i >= offset+4 && i < offset+8 {
				continue
			}
			if result[i] != input[i] {
				t.Fatalf("PCM/format/other chunk changed at %d", i)
			}
		}
		if _, _, err := finiteASRWAVInfo(result); err != nil {
			t.Fatalf("finite media consumer rejected output: %v", err)
		}
	}
	for _, extra := range []bool{false, true} {
		input, _ := cosyVoiceWAVForTest(false, extra)
		result, err := finishCompletedDashScopeWAV(input)
		if err != nil || !bytes.Equal(input, result) || &input[0] != &result[0] {
			t.Fatalf("valid finite container changed: %v", err)
		}
	}
}

func TestCosyVoiceWAVRejectsUnknownMixedAndTruncatedContainers(t *testing.T) {
	for name, mutate := range map[string]func([]byte, int) []byte{
		"unknown riff":         func(b []byte, _ int) []byte { binary.LittleEndian.PutUint32(b[4:8], 0xffffffff); return b },
		"unknown data":         func(b []byte, o int) []byte { binary.LittleEndian.PutUint32(b[o+4:o+8], 0xffffffff); return b },
		"mixed finite riff":    func(b []byte, _ int) []byte { binary.LittleEndian.PutUint32(b[4:8], uint32(len(b)-8)); return b },
		"incomplete sample":    func(b []byte, _ int) []byte { return b[:len(b)-1] },
		"truncated header":     func(b []byte, _ int) []byte { return b[:35] },
		"bad byte rate":        func(b []byte, _ int) []byte { b[28] = 0; return b },
		"unsupported encoding": func(b []byte, _ int) []byte { b[20] = 3; return b },
		"ambiguous stream padding": func(b []byte, _ int) []byte {
			b[34] = 8
			b[32] = 1
			binary.LittleEndian.PutUint32(b[28:32], 24000)
			return b
		},
		"incomplete fmt extension": func(b []byte, _ int) []byte { binary.LittleEndian.PutUint32(b[16:20], 17); return b },
	} {
		t.Run(name, func(t *testing.T) {
			b, o := cosyVoiceWAVForTest(true, false)
			if out, err := finishCompletedDashScopeWAV(mutate(b, o)); err == nil || out != nil {
				t.Fatal("bad streaming WAV became successful")
			}
		})
	}
	finite, _ := cosyVoiceWAVForTest(false, true)
	for _, b := range [][]byte{finite[:len(finite)-1], append(finite, 1), append(finite[:44:44], finite[45:]...)} {
		if out, err := finishCompletedDashScopeWAV(b); err == nil || out != nil {
			t.Fatal("truncated finite WAV was repaired")
		}
	}
}

func TestCosyVoiceWordPublishesFiniteWAVWithoutChangingAlignment(t *testing.T) {
	for _, bad := range []bool{false, true} {
		b, offset := cosyVoiceWAVForTest(true, true)
		if bad {
			binary.LittleEndian.PutUint32(b[4:8], 0xffffffff)
		}
		events := cosyWordEvents()
		events[1]["output"].(map[string]any)["audio"].(map[string]any)["data"] = base64.StdEncoding.EncodeToString(b[:100])
		events[4]["output"].(map[string]any)["audio"].(map[string]any)["data"] = base64.StdEncoding.EncodeToString(b[100:])
		_, alignment, _, _, err := readCosyVoiceWordStream(context.Background(), bytes.NewBufferString(encodeCosyWordEvents(events)))
		if err != nil {
			t.Fatal(err)
		}
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprint(w, encodeCosyWordEvents(events))
		}))
		spec := &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello. Nimi.", AudioFormat: "wav", TimingMode: runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD, VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "longanyang"}}}
		req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: spec}}}
		artifacts, _, _, err := ExecuteAlibabaNative(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, nil, "wave-job", req, "cosyvoice-v3-plus")
		server.Close()
		if bad {
			if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID || len(artifacts) != 0 {
				t.Fatalf("bad WAV published: %v %v", artifacts, err)
			}
			continue
		}
		if err != nil || len(artifacts) != 1 || !proto.Equal(artifacts[0].SpeechAlignment, alignment) {
			t.Fatalf("finite output/alignment=%v %v", artifacts, err)
		}
		out := artifacts[0].GetBytes()
		if !bytes.Equal(out[offset+8:], b[offset+8:]) {
			t.Fatal("published PCM changed")
		}
		if _, _, err := finiteASRWAVInfo(out); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCosyVoiceFiniteWAVPreservesAdmittedPCMFormatAndChunkExtension(t *testing.T) {
	for _, bits := range []uint16{8, 16, 24, 32} {
		b, _ := cosyVoiceWAVForTest(false, false)
		binary.LittleEndian.PutUint16(b[34:36], bits)
		binary.LittleEndian.PutUint16(b[32:34], bits/8)
		binary.LittleEndian.PutUint32(b[28:32], 24000*uint32(bits/8))
		out, err := finishCompletedDashScopeWAV(b)
		if err != nil || !bytes.Equal(b, out) {
			t.Fatalf("finite PCM%d changed: %v", bits, err)
		}
	}
	b, _ := cosyVoiceWAVForTest(false, false)
	extended := append(append([]byte(nil), b[:36]...), 0, 0)
	extended = append(extended, b[36:]...)
	binary.LittleEndian.PutUint32(extended[16:20], 18)
	binary.LittleEndian.PutUint32(extended[4:8], uint32(len(extended)-8))
	if out, err := finishCompletedDashScopeWAV(extended); err != nil || !bytes.Equal(out, extended) {
		t.Fatalf("valid fmt extension changed: %v", err)
	}
}

func TestCosyVoiceNoTimingWAVRetainsExistingTransportBytes(t *testing.T) {
	audio, _ := cosyVoiceWAVForTest(true, false)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write(audio)
	}))
	defer server.Close()
	spec := &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello", AudioFormat: "wav", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "longanyang"}}}
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: spec}}}
	artifacts, _, _, err := ExecuteAlibabaNative(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, nil, "no-timing", req, "cosyvoice-v3-plus")
	if err != nil || len(artifacts) != 1 || !bytes.Equal(artifacts[0].GetBytes(), audio) || artifacts[0].SpeechAlignment != nil {
		t.Fatalf("no-timing transport changed: %v %v", artifacts, err)
	}
}
