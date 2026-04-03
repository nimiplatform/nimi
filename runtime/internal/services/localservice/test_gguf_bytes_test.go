package localservice

import (
	"bytes"
	"encoding/binary"
)

func validTestGGUF() []byte {
	payload := make([]byte, minManagedGGUFSizeBytes)
	copy(payload[:8], []byte{'G', 'G', 'U', 'F', 0x03, 0x00, 0x00, 0x00})
	copy(payload[16:32], []byte("nimi-test-gguf!!"))
	return payload
}

func validImageTestGGUF() []byte {
	return buildImageTestGGUF([]ggufTestMetadataEntry{
		{Key: "general.architecture", Type: 8, StringValue: "stable-diffusion"},
		{Key: "general.name", Type: 8, StringValue: "z-image-turbo"},
		{Key: "sd.version", Type: 8, StringValue: "sdxl"},
	}, []string{"cap_embedder.0.weight"})
}

func validImageTestGGUFWithoutSDVersion() []byte {
	return buildImageTestGGUF(nil, []string{"cap_embedder.0.weight"})
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
