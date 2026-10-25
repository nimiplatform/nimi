package capabilitydriver

import (
	"fmt"
	"io"
)

// One opened-file probe owns this bounded window. It is never an integrity cache.
func newModelAssetProbeReaderAt(source io.ReaderAt, size int64, windowBytes int) *modelAssetProbeReaderAt {
	reader := &modelAssetProbeReaderAt{source: source, size: size, start: -1}
	if windowBytes > 0 && windowBytes <= 64<<10 {
		reader.data = make([]byte, windowBytes)
	}
	return reader
}

func (r *modelAssetProbeReaderAt) ContextErr() error {
	if checker, ok := r.source.(interface{ ContextErr() error }); ok {
		return checker.ContextErr()
	}
	return nil
}

type modelAssetProbeReaderAt struct {
	source io.ReaderAt
	size   int64
	start  int64
	valid  int
	data   []byte
}

func (r *modelAssetProbeReaderAt) ReadAt(p []byte, offset int64) (int, error) {
	if err := r.ContextErr(); err != nil {
		return 0, err
	}
	if len(r.data) == 0 {
		return 0, fmt.Errorf("invalid model metadata window")
	}
	if offset < 0 {
		return 0, fmt.Errorf("invalid model metadata read offset")
	}
	read := 0
	for len(p) > 0 {
		if offset >= r.size {
			return read, io.EOF
		}
		if r.start < 0 || offset < r.start || offset-r.start >= int64(r.valid) {
			windowBytes := int64(len(r.data))
			start := offset / windowBytes * windowBytes
			length := min(windowBytes, r.size-start)
			n, err := r.source.ReadAt(r.data[:length], start)
			if n < 0 || int64(n) > length {
				return read, fmt.Errorf("invalid model metadata source read count")
			}
			if err != nil && err != io.EOF {
				return read, err
			}
			if int64(n) < length && err == nil {
				return read, io.ErrUnexpectedEOF
			}
			r.start, r.valid = start, n
			if offset-start >= int64(n) {
				return read, io.EOF
			}
		}
		available := r.valid - int(offset-r.start)
		n := copy(p, r.data[offset-r.start:int(offset-r.start)+available])
		read += n
		offset += int64(n)
		p = p[n:]
	}
	return read, nil
}
