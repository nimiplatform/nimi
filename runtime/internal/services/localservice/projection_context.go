package localservice

import (
	"context"
	"io"
)

// @nimi-authority: rule.nimi.runtime.local-compute.r066
// Projection reads retain the same validation and byte bounds. Cancellation
// stops the next read without converting an interrupted probe to model damage.
type projectionReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r projectionReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

type projectionReaderAt struct {
	ctx    context.Context
	reader io.ReaderAt
}

// Buffered format readers must keep the cancellation fence on window hits.
func (r projectionReaderAt) ContextErr() error { return r.ctx.Err() }

func (r projectionReaderAt) ReadAt(p []byte, offset int64) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.ReadAt(p, offset)
}
