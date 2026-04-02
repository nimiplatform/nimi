package localservice

func validTestGGUF() []byte {
	payload := make([]byte, minManagedGGUFSizeBytes)
	copy(payload[:8], []byte{'G', 'G', 'U', 'F', 0x03, 0x00, 0x00, 0x00})
	copy(payload[16:32], []byte("nimi-test-gguf!!"))
	return payload
}
