package engine

import (
	"errors"
	"io"
	"sync"
)

type residentOutputBody struct {
	io.ReadCloser
	release func()
	once    sync.Once
	err     error
}

func (body *residentOutputBody) Read(target []byte) (int, error) {
	n, err := body.ReadCloser.Read(target)
	if err != nil {
		if closeErr := body.Close(); closeErr != nil {
			err = errors.Join(err, closeErr)
		}
	}
	return n, err
}

func (body *residentOutputBody) Close() error {
	body.once.Do(func() { body.err = body.ReadCloser.Close(); body.release() })
	return body.err
}
