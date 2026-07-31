package localservice

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
)

func validTestGGUF() []byte {
	payload := make([]byte, minManagedGGUFSizeBytes)
	copy(payload[:8], []byte{'G', 'G', 'U', 'F', 0x03, 0x00, 0x00, 0x00})
	copy(payload[16:32], []byte("nimi-test-gguf!!"))
	return payload
}

func validGemma4TestGGUF() []byte {
	return buildImageTestGGUF([]ggufTestMetadataEntry{
		{Key: "general.architecture", Type: 8, StringValue: "gemma4"},
		{Key: "general.name", Type: 8, StringValue: "gemma-4-test"},
		{Key: "gemma4.context_length", Type: 4, Uint32Value: 262144},
	}, []string{"tok_embeddings.weight"})
}

func validGemma4TestGGUFHash() string {
	sum := sha256.Sum256(validGemma4TestGGUF())
	return hex.EncodeToString(sum[:])
}

func validTestGGUFHash() string {
	sum := sha256.Sum256(validTestGGUF())
	return hex.EncodeToString(sum[:])
}

func validImageTestGGUF() []byte {
	return buildImageTestGGUF([]ggufTestMetadataEntry{
		{Key: "general.architecture", Type: 8, StringValue: "stable-diffusion"},
		{Key: "general.name", Type: 8, StringValue: "z-image-turbo"},
		{Key: "sd.version", Type: 8, StringValue: "sdxl"},
	}, []string{"cap_embedder.0.weight"})
}

func validImageTestGGUFHash() string {
	sum := sha256.Sum256(validImageTestGGUF())
	return hex.EncodeToString(sum[:])
}

func validImageTestGGUFWithoutSDVersion() []byte {
	return buildImageTestGGUF(nil, []string{"cap_embedder.0.weight"})
}

func validIdeogram4ImageTestGGUFWithoutMetadata() []byte {
	return buildImageTestGGUF(nil, []string{
		"embed_image_indicator.weight",
		"llm_cond_proj.weight",
		"final_layer.adaln_modulation.weight",
	})
}

func validIdeogram4ImageTestGGUFWithoutMetadataHash() string {
	sum := sha256.Sum256(validIdeogram4ImageTestGGUFWithoutMetadata())
	return hex.EncodeToString(sum[:])
}

func invalidImageTestGGUFWithoutKnownDiffusionSignature() []byte {
	return buildImageTestGGUF(nil, []string{"tok_embeddings.weight"})
}

type ggufTestMetadataEntry struct {
	Key         string
	Type        uint32
	StringValue string
	Uint32Value uint32
}

func buildImageTestGGUF(entries []ggufTestMetadataEntry, tensorNames []string) []byte {
	var buf bytes.Buffer
	buf.WriteString(ggufMagicHeader)
	_ = binary.Write(&buf, binary.LittleEndian, uint32(3))
	_ = binary.Write(&buf, binary.LittleEndian, uint64(len(tensorNames)))
	_ = binary.Write(&buf, binary.LittleEndian, uint64(len(entries)))
	for _, entry := range entries {
		writeTestGGUFString(&buf, entry.Key)
		_ = binary.Write(&buf, binary.LittleEndian, entry.Type)
		switch entry.Type {
		case 8:
			writeTestGGUFString(&buf, entry.StringValue)
		case 4:
			_ = binary.Write(&buf, binary.LittleEndian, entry.Uint32Value)
		}
	}
	for idx, name := range tensorNames {
		writeTestGGUFString(&buf, name)
		_ = binary.Write(&buf, binary.LittleEndian, uint32(1))
		_ = binary.Write(&buf, binary.LittleEndian, uint64(idx+1))
		_ = binary.Write(&buf, binary.LittleEndian, uint32(0))
		_ = binary.Write(&buf, binary.LittleEndian, uint64(0))
	}

	return append(buf.Bytes(), bytes.Repeat([]byte{0}, minManagedGGUFSizeBytes)...)
}

func writeTestGGUFString(buf *bytes.Buffer, value string) {
	_ = binary.Write(buf, binary.LittleEndian, uint64(len(value)))
	_, _ = buf.WriteString(value)
}
