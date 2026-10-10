package runtimeartifact

import (
	"context"
	"errors"
	"fmt"
	"io"
)

// JobFiles gives an owned codec named access to an declared private set. It
// cannot create more slots, select another owner, or write an arbitrary path.
type JobFiles struct {
	store JobBodyStore
	jobID string
	owner *ArtifactOwner
	ids   map[string]string
}

func NewJobFiles(store JobBodyStore, jobID string, owner *ArtifactOwner, ids map[string]string) *JobFiles {
	copy := make(map[string]string, len(ids))
	for name, id := range ids {
		copy[name] = id
	}
	return &JobFiles{store: store, jobID: jobID, owner: owner, ids: copy}
}

func (f *JobFiles) Write(ctx context.Context, name, mime string, produce func(io.Writer) error) error {
	id := f.ids[name]
	if id == "" || produce == nil {
		return fmt.Errorf("codec output is not in the owned set")
	}
	reader, writer := io.Pipe()
	done := make(chan error, 1)
	go func() { err := produce(writer); writer.CloseWithError(err); done <- err }()
	err := f.store.StageJobBody(ctx, id, ArtifactRecord{ProducerJobID: f.jobID, Owner: f.owner, MimeType: mime}, reader)
	reader.Close()
	// Never release the work claim while an ffmpeg writer still owns stdout.
	return errors.Join(err, <-done)
}

func (f *JobFiles) Borrow(ctx context.Context, name string) (string, func(), error) {
	id := f.ids[name]
	if id == "" {
		return "", nil, fmt.Errorf("codec input is not in the owned set")
	}
	return f.store.BorrowJobBodyFile(ctx, f.jobID, id)
}
