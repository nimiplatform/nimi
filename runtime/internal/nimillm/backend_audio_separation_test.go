package nimillm

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type separationSourceReader struct{ remaining int64 }

func (r *separationSourceReader) Read(p []byte) (int, error) {
	if r.remaining == 0 {
		return 0, io.EOF
	}
	n := int(min(int64(len(p)), r.remaining))
	clear(p[:n])
	r.remaining -= int64(n)
	return n, nil
}

func TestAudioSeparationStreamsOwnedSourceBeyondInlineCeiling(t *testing.T) {
	const size = 33<<20 + 17
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reader, err := r.MultipartReader()
		if err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		fields := map[string]string{}
		var copied int64
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Error(err)
				return
			}
			if part.FormName() == "file" {
				copied, err = io.Copy(io.Discard, part)
			} else {
				var value []byte
				value, err = io.ReadAll(part)
				fields[part.FormName()] = string(value)
			}
			if err != nil {
				t.Error(err)
				return
			}
		}
		if copied != size || fields["model"] != "captured-demucs" || fields["mime_type"] != "audio/wav" {
			t.Errorf("incomplete typed upload: bytes=%d fields=%v", copied, fields)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	response, err := NewBackend("speech", server.URL, "", 5*time.Second).OpenAudioSeparation(context.Background(), "captured-demucs", &separationSourceReader{remaining: size}, "audio/wav")
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
}
