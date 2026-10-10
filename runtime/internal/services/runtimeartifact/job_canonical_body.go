package runtimeartifact

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
)

type CanonicalJobBodyWriter interface {
	io.Writer
	io.WriterAt
}
type canonicalJobBodyWriter struct {
	ctx                   context.Context
	file                  *os.File
	limit, position, size int64
	limitError            error
}

func (w *canonicalJobBodyWriter) Write(p []byte) (int, error) {
	n, err := w.WriteAt(p, w.position)
	w.position += int64(n)
	return n, err
}
func (w *canonicalJobBodyWriter) WriteAt(p []byte, offset int64) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	if offset < 0 || offset > w.size || offset > w.limit || int64(len(p)) > w.limit-offset {
		return 0, w.limitError
	}
	n, err := w.file.WriteAt(p, offset)
	w.size = max(w.size, offset+int64(n))
	return n, err
}

// The codec uses an ordinary bounded private writer. Its only
// random write is within already-produced bytes (the completed WAV header).
func (s *DiskStore) WriteCanonicalJobBody(ctx context.Context, id string, record ArtifactRecord, produce func(CanonicalJobBodyWriter) (*CanonicalAudioInfo, error)) error {
	if ctx == nil || produce == nil || record.MimeType != "audio/wav" {
		return ErrInvalidArtifactRecord
	}
	file, reserved, limit, err := s.openJobBodyImport(id, record)
	if err != nil {
		return err
	}
	defer s.finishJobBodyImport(id)
	defer file.Close()
	writer := &canonicalJobBodyWriter{ctx: ctx, file: file, limit: limit, limitError: jobBodyLimitError(limit, reserved.JobCandidate.MaxBytes)}
	record.CanonicalAudio, err = produce(writer)
	if err != nil {
		return err
	}
	if record.CanonicalAudio == nil || writer.size <= 0 {
		return ErrInvalidArtifactRecord
	}
	hash := sha256.New()
	size, err := copyArtifactStream(ctx, io.Discard, hash, io.NewSectionReader(file, 0, writer.size))
	if err != nil {
		return err
	}
	value, err := normalizeStreamedArtifactRecord(record, size, "sha256:"+hex.EncodeToString(hash.Sum(nil)))
	if err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// Integrity metadata follows the exact complete file shape.
	if err := file.Truncate(size); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	reserved.SizeBytes, reserved.ContentSHA256, reserved.MimeType = size, value.ContentSHA256, value.MimeType
	reserved.CanonicalAudio, reserved.MusicRecoveryUntil = value.CanonicalAudio, value.MusicRecoveryUntil
	reserved.JobCandidate.Complete = true
	if err := s.writeJobBodyRecordLocked(reserved); err != nil {
		return err
	}
	return nil
}
func (s *MemoryStore) WriteCanonicalJobBody(context.Context, string, ArtifactRecord, func(CanonicalJobBodyWriter) (*CanonicalAudioInfo, error)) error {
	return fmt.Errorf("canonical file custody requires a disk-backed Runtime owner")
}
