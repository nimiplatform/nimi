package engine

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/textproto"
	"testing"
)

type separationCountingBody struct {
	*bytes.Reader
	closes int
}

func (body *separationCountingBody) Close() error { body.closes++; return nil }

func separationResponseForTest(t *testing.T, names []string) (*separationCountingBody, string) {
	t.Helper()
	buffer := &bytes.Buffer{}
	writer := multipart.NewWriter(buffer)
	if err := writer.WriteField("metadata", `{"sample_rate_hz":44100,"channels":2,"sample_count":44100}`); err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		part, err := writer.CreatePart(textproto.MIMEHeader{"Content-Disposition": {fmt.Sprintf(`form-data; name="%s"; filename="%s.wav"`, name, name)}, "Content-Type": {"audio/wav"}})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte(name + "-transport-unit-fixture")); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return &separationCountingBody{Reader: bytes.NewReader(buffer.Bytes())}, "multipart/mixed; boundary=" + writer.Boundary()
}

func TestAudioSeparationReadsBothStreamsBeforeClosingTransport(t *testing.T) {
	body, mime := separationResponseForTest(t, []string{"vocals", "background"})
	result, err := decodeAudioSeparation(body, mime)
	if err != nil {
		t.Fatal(err)
	}
	vocals, err := io.ReadAll(result.Vocals)
	if err != nil || string(vocals) != "vocals-transport-unit-fixture" {
		t.Fatalf("vocals=%q err=%v", vocals, err)
	}
	if err := result.Vocals.Close(); err != nil {
		t.Fatal(err)
	}
	if body.closes != 0 {
		t.Fatal("vocals closed the still-unread background transport")
	}
	background, err := io.ReadAll(result.Background)
	if err != nil || string(background) != "background-transport-unit-fixture" {
		t.Fatalf("background=%q err=%v", background, err)
	}
	_ = result.Background.Close()
	if body.closes != 1 || result.SampleCount != 44100 || result.SampleRateHz != 44100 || result.Channels != 2 {
		t.Fatalf("pair close/metadata: %+v closes=%d", result, body.closes)
	}
}

func TestAudioSeparationRejectsMissingReorderedAndExtraStems(t *testing.T) {
	for _, names := range [][]string{{"vocals"}, {"background", "vocals"}, {"vocals", "background", "extra"}} {
		t.Run(fmt.Sprint(names), func(t *testing.T) {
			body, mime := separationResponseForTest(t, names)
			result, err := decodeAudioSeparation(body, mime)
			if err != nil {
				t.Fatal(err)
			}
			_, firstErr := io.Copy(io.Discard, result.Vocals)
			_ = result.Vocals.Close()
			_, secondErr := io.Copy(io.Discard, result.Background)
			_ = result.Background.Close()
			if firstErr == nil && secondErr == nil {
				t.Fatal("invalid stem pair was accepted")
			}
			if body.closes != 1 {
				t.Fatalf("transport closes=%d", body.closes)
			}
		})
	}
}

func TestAudioSeparationAbandonedFirstBodyClosesBoth(t *testing.T) {
	body, mime := separationResponseForTest(t, []string{"vocals", "background"})
	result, err := decodeAudioSeparation(body, mime)
	if err != nil {
		t.Fatal(err)
	}
	_ = result.Vocals.Close()
	if _, err := result.Background.Read(make([]byte, 1)); err == nil {
		t.Fatal("background remained readable after abandoning its pair")
	}
	_ = result.Background.Close()
	if body.closes != 1 {
		t.Fatalf("transport closes=%d", body.closes)
	}
}
