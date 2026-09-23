package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.demucs-local-separation
func (host *SpeechExecutionHost) ExecuteAudioSeparation(ctx context.Context, plan *capabilitydriver.AudioSeparateInvocationPlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.AudioSeparationResult, error) {
	if plan != nil && plan.IsNative() {
		return host.executeNativeAudioSeparation(ctx, plan, onStart)
	}
	if host == nil || host.materializer == nil || plan == nil || plan.ModelAssetID() == "" {
		return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureLoad, fmt.Errorf("audio separation Host is unavailable"))
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureCanceled, err)
	}
	defer func() { release(); host.residentModelAssets.notifyIdle() }()
	if host.poisoned != nil {
		return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureProcessCrash, host.poisoned)
	}
	if err := beginSpeechExecution(ctx, onStart); err != nil {
		return localexecution.AudioSeparationResult{}, err
	}
	files := plan.ModelFiles()
	seals, err := sealInvocationModelContentContext(ctx, files)
	if err != nil {
		return localexecution.AudioSeparationResult{}, speechContentSealError(ctx, err)
	}
	backend, err := host.materializeBackend(ctx, capabilitydriver.AudioSeparateContract, plan.DriverID(), plan.ModelAssetID(), files, seals, "", "")
	if err != nil {
		return localexecution.AudioSeparationResult{}, host.speechHostBackendError(ctx, err)
	}
	started := time.Now()
	response, err := backend.OpenAudioSeparation(ctx, plan.ModelAssetID(), plan.AudioBytes(), plan.MIMEType())
	if err != nil {
		return localexecution.AudioSeparationResult{}, host.speechHostBackendError(ctx, err)
	}
	body := host.residentModelAssets.holdOutput(response.Body)
	result, err := decodeAudioSeparation(body, response.Header.Get("Content-Type"))
	if err != nil {
		_ = body.Close()
		return localexecution.AudioSeparationResult{}, speechHostError(localexecution.FailureInference, err)
	}
	result.Usage = &runtimev1.UsageStats{ComputeMs: time.Since(started).Milliseconds()}
	return result, nil
}

type audioSeparationStream struct {
	body   io.ReadCloser
	reader *multipart.Reader
	next   int
	closed bool
}

func (stream *audioSeparationStream) close() error {
	if stream.closed {
		return nil
	}
	stream.closed = true
	return stream.body.Close()
}

// The existing local speech Job order owns the complete body-consumption
// lifetime. These two streams have one sequential reader and Close owner.
type audioStemBody struct {
	stream *audioSeparationStream
	index  int
	name   string
	part   *multipart.Part
	done   bool
}

func (body *audioStemBody) Read(target []byte) (int, error) {
	if body.done {
		return 0, io.EOF
	}
	if body.stream.closed || body.stream.next != body.index {
		return 0, fmt.Errorf("separation body is closed or out of order")
	}
	if body.part == nil {
		part, err := body.stream.reader.NextPart()
		if err != nil {
			_ = body.stream.close()
			return 0, fmt.Errorf("missing %s separation output: %w", body.name, err)
		}
		if part.FormName() != body.name || part.Header.Get("Content-Type") != "audio/wav" {
			_ = body.stream.close()
			return 0, fmt.Errorf("separation output role or media type is invalid")
		}
		body.part = part
	}
	n, err := body.part.Read(target)
	if err == io.EOF {
		body.done = true
		body.stream.next++
		if body.index == 1 {
			_, trailingErr := body.stream.reader.NextPart()
			closeErr := body.stream.close()
			if trailingErr != io.EOF {
				return n, fmt.Errorf("separation response has missing termination or extra output")
			}
			if closeErr != nil {
				return n, closeErr
			}
		}
	} else if err != nil {
		_ = body.stream.close()
	}
	return n, err
}

func (body *audioStemBody) Close() error {
	if !body.done {
		return body.stream.close()
	}
	return nil
}

func decodeAudioSeparation(body io.ReadCloser, contentType string) (localexecution.AudioSeparationResult, error) {
	typeName, parameters, err := mime.ParseMediaType(contentType)
	if err != nil || typeName != "multipart/mixed" || parameters["boundary"] == "" || body == nil {
		return localexecution.AudioSeparationResult{}, fmt.Errorf("separation response is not typed multipart audio")
	}
	reader := multipart.NewReader(body, parameters["boundary"])
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "metadata" {
		return localexecution.AudioSeparationResult{}, fmt.Errorf("separation response lacks metadata")
	}
	data, err := io.ReadAll(io.LimitReader(part, 4097))
	if err != nil || len(data) > 4096 {
		return localexecution.AudioSeparationResult{}, fmt.Errorf("separation metadata is invalid")
	}
	var metadata struct {
		SampleRateHz int32 `json:"sample_rate_hz"`
		Channels     int32 `json:"channels"`
		SampleCount  int64 `json:"sample_count"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&metadata); err != nil {
		return localexecution.AudioSeparationResult{}, fmt.Errorf("decode separation metadata: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF || metadata.SampleRateHz != 44100 || metadata.Channels != 2 || metadata.SampleCount <= 0 || metadata.SampleCount > 300*44100 {
		return localexecution.AudioSeparationResult{}, fmt.Errorf("separation metadata dimensions are invalid")
	}
	stream := &audioSeparationStream{body: body, reader: reader}
	return localexecution.AudioSeparationResult{
		Vocals:       &audioStemBody{stream: stream, index: 0, name: "vocals"},
		Background:   &audioStemBody{stream: stream, index: 1, name: "background"},
		SampleRateHz: metadata.SampleRateHz, Channels: metadata.Channels, SampleCount: metadata.SampleCount,
	}, nil
}
