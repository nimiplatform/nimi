package workerproxy

import (
	"errors"
	"io"
)

func forwardServerStream[T any](recv func() (T, error), send func(T) error) error {
	for {
		item, err := recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		if err := send(item); err != nil {
			return err
		}
	}
}
