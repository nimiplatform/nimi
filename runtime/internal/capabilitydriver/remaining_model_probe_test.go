package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func whisperCT2ProbeHeaderForTest() []byte {
	name := []byte("WhisperSpec\x00")
	header := make([]byte, 6+len(name)+8)
	binary.LittleEndian.PutUint32(header, 6)
	binary.LittleEndian.PutUint16(header[4:], uint16(len(name)))
	copy(header[6:], name)
	binary.LittleEndian.PutUint32(header[6+len(name):], 3)
	binary.LittleEndian.PutUint32(header[10+len(name):], 1)
	return header
}

func TestRemainingModelStructuredProbeReadCost(t *testing.T) {
	header := safetensorsProbeForTest([]byte(`{"weight":{"dtype":"F16","shape":[1],"data_offsets":[0,2]}}`))
	for _, driver := range []Driver{VoxCPMDriver{}, LayaDriver{}, GroundingDinoDriver{}} {
		t.Run(fmt.Sprintf("%T", driver), func(t *testing.T) {
			source := &safetensorsProbeReadCounter{prefix: header, size: 64 << 20}
			probe, err := safetensorsDriverProbeForTest(driver, ModelAssetFormatProbeInput{RelativePath: "model.safetensors", Entry: true}, source, source.size)
			if err != nil || !bytes.Equal(probe, header) || source.bytes != int64(len(header)) || source.reads != 2 {
				t.Fatalf("header=%d bytes, actual reads=%d/%d, returned=%d, err=%v", len(header), source.bytes, source.reads, len(probe), err)
			}
		})
	}
	for _, driver := range []Driver{FasterWhisperDriver{}, FasterWhisperSherpaDriver{}} {
		t.Run(fmt.Sprintf("%T", driver), func(t *testing.T) {
			header := whisperCT2ProbeHeaderForTest()
			source := &safetensorsProbeReadCounter{prefix: header, size: 64 << 20}
			probe, err := safetensorsDriverProbeForTest(driver, ModelAssetFormatProbeInput{RelativePath: "model.bin", Entry: true, RequirementID: Qwen3ASRModelRequirementID}, source, source.size)
			if err != nil || !bytes.Equal(probe, header) || source.bytes != int64(len(header)) || source.reads != 1 {
				t.Fatalf("CT2 header=%d bytes, actual reads=%d/%d, returned=%d, err=%v", len(header), source.bytes, source.reads, len(probe), err)
			}
		})
	}
}

func TestRemainingModelStructuredProbeUnusedFiles(t *testing.T) {
	for _, test := range []struct {
		driver Driver
		path   string
	}{
		{VoxCPMDriver{}, "tokenizer.json"}, {VoxCPMDriver{}, "audiovae.safetensors"},
		{LayaDriver{}, "checkpoint/tokenizer/tokenizer.json"},
		{GroundingDinoDriver{}, "README.md"},
		{FasterWhisperDriver{}, "tokenizer.json"}, {FasterWhisperSherpaDriver{}, "config.json"},
	} {
		t.Run(fmt.Sprintf("%T/%s", test.driver, test.path), func(t *testing.T) {
			source := &safetensorsProbeReadCounter{size: 8 << 20}
			probe, err := safetensorsDriverProbeForTest(test.driver, ModelAssetFormatProbeInput{RelativePath: test.path, RequirementID: Qwen3ASRModelRequirementID}, source, source.size)
			if err != nil || len(probe) != 0 || source.bytes != 0 {
				t.Fatalf("unused prefix read %d bytes, returned=%d, err=%v", source.bytes, len(probe), err)
			}
		})
	}
}

func remainingBindingProbesForTest(t *testing.T, driver Driver, input ModelAssetBindingInput) ModelAssetBindingInput {
	t.Helper()
	for index := range input.Files {
		fact := &input.Files[index]
		entry := fact.RelativePath == input.Entry.RelativePath
		size := int64(len(fact.FormatProbe))
		if entry {
			size += 64 // bounded virtual tensor data for these header fixtures
		}
		source := &safetensorsProbeReadCounter{prefix: fact.FormatProbe, size: size}
		probe, err := safetensorsDriverProbeForTest(driver, ModelAssetFormatProbeInput{
			RecipeID: input.RecipeID, RequirementID: input.Requirement.GetRequirementId(), RelativePath: fact.RelativePath, Entry: entry,
		}, source, size)
		if err != nil {
			t.Fatalf("probe %s: %v", fact.RelativePath, err)
		}
		fact.SizeBytes, fact.FormatProbe = size, probe
		if entry {
			input.Entry = *fact
		}
	}
	return input
}

func TestLayaStructuredProbeChecksOnlySelectedCompleteConfigs(t *testing.T) {
	driver := LayaDriver{}
	for _, prefix := range []string{"", "checkpoint/"} {
		input := layaBindingInput(t, prefix, nil)
		input.Files = append(input.Files,
			ModelAssetFileFact{RelativePath: "unselected/encoder/config.json", FormatProbe: []byte("not JSON")},
			ModelAssetFileFact{RelativePath: "other/rl_agent_config.json", FormatProbe: bytes.Repeat([]byte("x"), layaConfigProbeBytes+1)},
			ModelAssetFileFact{RelativePath: "other/tokenizer/tokenizer_config.json"},
		)
		input = remainingBindingProbesForTest(t, driver, input)
		if _, reason := driver.ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			t.Fatalf("unselected bad config broke %q checkpoint: %v", prefix, reason)
		}
		for _, name := range []string{layaAgentConfigFile, layaEncoderConfigFile, layaTokenizerConfigFile} {
			for index := range input.Files {
				if input.Files[index].RelativePath != prefix+name {
					continue
				}
				input.Files[index].SizeBytes++
				if _, reason := driver.ProjectModelAssetBinding(input); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
					t.Fatalf("incomplete selected %s accepted", name)
				}
				input.Files[index].SizeBytes--
			}
		}
	}
	for _, size := range []int{layaConfigProbeBytes, layaConfigProbeBytes + 1} {
		input := layaBindingInput(t, "checkpoint/", func(files map[string][]byte) {
			body := files[layaEncoderConfigFile]
			files[layaEncoderConfigFile] = append(body, bytes.Repeat([]byte(" "), size-len(body))...)
		})
		input = remainingBindingProbesForTest(t, driver, input)
		_, reason := driver.ProjectModelAssetBinding(input)
		if (reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED) != (size == layaConfigProbeBytes) {
			t.Fatalf("selected config size %d: %v", size, reason)
		}
	}
}

func TestGroundingDinoStructuredProbeKeepsCompleteTokenizerAndVocabulary(t *testing.T) {
	driver := GroundingDinoDriver{}
	for _, base := range []bool{false, true} {
		input, _ := groundingDinoBindingFixture(t, base)
		input = remainingBindingProbesForTest(t, driver, input)
		for _, fact := range input.Files {
			if fact.RelativePath != input.Entry.RelativePath && int64(len(fact.FormatProbe)) != fact.SizeBytes {
				t.Fatalf("consumed %s was truncated or skipped", fact.RelativePath)
			}
		}
		if _, reason := driver.ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			t.Fatalf("complete tokenizer rejected for base=%v: %v", base, reason)
		}
		for index := range input.Files {
			if input.Files[index].RelativePath != "vocab.txt" {
				continue
			}
			// Corruption at the end of the vocabulary must still be compared
			// with the complete tokenizer's token-to-ID mapping.
			input.Files[index].FormatProbe = bytes.Replace(input.Files[index].FormatProbe, []byte("word-30521"), []byte("wrong-last"), 1)
			input.Files[index].SizeBytes = int64(len(input.Files[index].FormatProbe))
		}
		if _, reason := driver.ProjectModelAssetBinding(input); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			t.Fatal("changed final vocabulary token accepted")
		}
	}
	for _, path := range []string{"tokenizer.json", "vocab.txt", "added_tokens.json"} {
		if _, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RelativePath: path}, strings.NewReader(`{}`), MaxAssetFormatProbeBytes+1); err == nil {
			t.Fatalf("oversized complete %s accepted", path)
		}
	}
}

type remainingProbeFailureReader struct{ err error }

func (r remainingProbeFailureReader) ReadAt([]byte, int64) (int, error) { return 0, r.err }

func TestRemainingModelStructuredProbeRejectsShortReadsAndKeepsCancellation(t *testing.T) {
	for _, test := range []struct {
		driver Driver
		input  ModelAssetFormatProbeInput
	}{
		{VoxCPMDriver{}, ModelAssetFormatProbeInput{RelativePath: "model.safetensors", Entry: true}},
		{VoxCPMDriver{}, ModelAssetFormatProbeInput{RelativePath: "config.json"}},
		{LayaDriver{}, ModelAssetFormatProbeInput{RelativePath: "checkpoint/model.safetensors", Entry: true}},
		{LayaDriver{}, ModelAssetFormatProbeInput{RelativePath: "checkpoint/encoder/config.json"}},
		{GroundingDinoDriver{}, ModelAssetFormatProbeInput{RelativePath: "model.safetensors", Entry: true}},
		{GroundingDinoDriver{}, ModelAssetFormatProbeInput{RelativePath: "tokenizer.json"}},
		{GroundingDinoDriver{}, ModelAssetFormatProbeInput{RelativePath: "vocab.txt"}},
		{FasterWhisperDriver{}, ModelAssetFormatProbeInput{RelativePath: "model.bin", Entry: true, RequirementID: Qwen3ASRModelRequirementID}},
	} {
		for _, want := range []error{io.ErrUnexpectedEOF, context.Canceled} {
			probe, err := safetensorsDriverProbeForTest(test.driver, test.input, remainingProbeFailureReader{err: want}, 4096)
			if probe != nil || !errors.Is(err, want) {
				t.Fatalf("%T %s returned partial success for %v: len=%d err=%v", test.driver, test.input.RelativePath, want, len(probe), err)
			}
		}
	}
}

func TestWhisperStructuredProbePreservesExactCT2AndONNXBranches(t *testing.T) {
	input := ModelAssetFormatProbeInput{RelativePath: "model.bin", Entry: true, RequirementID: Qwen3ASRModelRequirementID}
	for _, driver := range []Driver{FasterWhisperDriver{}, FasterWhisperSherpaDriver{}} {
		for name, mutate := range map[string]func([]byte){
			"version":         func(b []byte) { binary.LittleEndian.PutUint32(b, 5) },
			"spec-length":     func(b []byte) { binary.LittleEndian.PutUint16(b[4:], 11) },
			"spec-name":       func(b []byte) { b[6] = 'X' },
			"null-terminator": func(b []byte) { b[17] = 'X' },
			"revision":        func(b []byte) { binary.LittleEndian.PutUint32(b[18:], 2) },
			"variables":       func(b []byte) { binary.LittleEndian.PutUint32(b[22:], 0) },
		} {
			header := whisperCT2ProbeHeaderForTest()
			mutate(header)
			if probe, err := safetensorsDriverProbeForTest(driver, input, bytes.NewReader(header), 64<<20); err == nil || probe != nil {
				t.Fatalf("%T accepted bad CT2 %s", driver, name)
			}
		}
		header := whisperCT2ProbeHeaderForTest()
		if _, err := safetensorsDriverProbeForTest(driver, input, bytes.NewReader(header[:25]), 26); err == nil {
			t.Fatalf("%T accepted short CT2 read", driver)
		}
		if _, err := safetensorsDriverProbeForTest(driver, ModelAssetFormatProbeInput{RelativePath: "config.json"}, bytes.NewReader(nil), 0); err == nil {
			t.Fatalf("%T accepted empty Whisper companion", driver)
		}
		vad := ModelAssetFormatProbeInput{RelativePath: "model.onnx", Entry: true, RequirementID: FasterWhisperVADRequirementID}
		if _, err := safetensorsDriverProbeForTest(driver, vad, bytes.NewReader(header), int64(len(header))); err == nil {
			t.Fatalf("%T VAD accepted CT2 bytes instead of ONNX", driver)
		}
	}
	for _, slot := range []string{SpeechSegmenterSlot, SpeechSpeakerEncoderSlot} {
		if _, err := (FasterWhisperSherpaDriver{}).ProbeModelAsset(ModelAssetFormatProbeInput{RelativePath: "extra.json", RequirementID: slot}, strings.NewReader(`{}`), 2); err == nil {
			t.Fatalf("Sherpa %s admitted a non-entry companion", slot)
		}
	}
}
