package managedimagebackend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/dynamicpb"
)

const videoFFIAllowUnpinnedEnv = "NIMI_VIDEO_FFI_ALLOW_UNPINNED"

type videoPackageIdentity struct {
	Name                   string   `json:"name,omitempty"`
	Alias                  string   `json:"alias,omitempty"`
	SupportedModelFamilies []string `json:"supported_model_families,omitempty"`
}

func (identity videoPackageIdentity) String() string {
	if strings.TrimSpace(identity.Name) != "" {
		return strings.TrimSpace(identity.Name)
	}
	return strings.TrimSpace(identity.Alias)
}

func (identity videoPackageIdentity) supportsH3() bool {
	for _, family := range identity.SupportedModelFamilies {
		if strings.EqualFold(strings.TrimSpace(family), "minimax-h3") {
			return true
		}
	}
	return false
}

func resolveVideoPackageIdentity(executablePath string) videoPackageIdentity {
	directory := filepath.Dir(strings.TrimSpace(executablePath))
	cursor := directory
	for depth := 0; depth < 4; depth++ {
		raw, err := os.ReadFile(filepath.Join(cursor, "metadata.json"))
		if err == nil {
			var identity videoPackageIdentity
			if json.Unmarshal(raw, &identity) == nil {
				return identity
			}
		}
		parent := filepath.Dir(cursor)
		if parent == cursor {
			break
		}
		cursor = parent
	}
	return videoPackageIdentity{Name: filepath.Base(directory)}
}

func (s *Server) videoCompatible() bool {
	return s.videoPackage.supportsH3() || strings.TrimSpace(os.Getenv(videoFFIAllowUnpinnedEnv)) == "1"
}

func (s *Server) handleLoadVideoModel(stream grpc.ServerStream) error {
	requestMessage := dynamicpb.NewMessage(loadVideoModelRequestDescriptor)
	if err := stream.RecvMsg(requestMessage); err != nil {
		return err
	}
	request, err := decodeVideoModelRequest(requestMessage)
	if err != nil {
		return stream.SendMsg(protocolErrorResult(err))
	}
	if !s.videoCompatible() {
		err := videoError(VideoErrorEngineIncompatible, fmt.Errorf("managed backend package %q is not marked MiniMax-H3 capable", s.videoPackage.String()))
		return stream.SendMsg(protocolErrorResult(err))
	}
	if s.videoEngine == nil {
		err := videoError(VideoErrorLoad, fmt.Errorf("managed video FFI engine is unavailable"))
		return stream.SendMsg(protocolErrorResult(err))
	}

	s.videoGenerateMu.Lock()
	defer s.videoGenerateMu.Unlock()
	reused, err := s.videoEngine.Load(request)
	if err != nil {
		if VideoErrorKindOf(err) == "" {
			err = videoError(VideoErrorLoad, fmt.Errorf("load video engine: %w", err))
		}
		return stream.SendMsg(protocolErrorResult(err))
	}
	s.videoStateMu.Lock()
	s.videoLoaded = true
	s.videoStateMu.Unlock()
	return stream.SendMsg(videoOperationResult(true, "loaded", "", reused, s.videoPackage.String()))
}

func (s *Server) handleGenerateVideo(stream grpc.ServerStream) error {
	requestMessage := dynamicpb.NewMessage(generateVideoRequestDescriptor)
	if err := stream.RecvMsg(requestMessage); err != nil {
		return err
	}
	request, err := decodeVideoGenerateRequest(requestMessage)
	if err != nil {
		return stream.SendMsg(videoTerminalEvent(VideoCandidate{}, err))
	}
	if !s.videoCompatible() {
		err := videoError(VideoErrorEngineIncompatible, fmt.Errorf("managed backend package %q is not marked MiniMax-H3 capable", s.videoPackage.String()))
		return stream.SendMsg(videoTerminalEvent(VideoCandidate{}, err))
	}
	s.videoStateMu.Lock()
	loaded := s.videoLoaded
	s.videoStateMu.Unlock()
	if !loaded || s.videoEngine == nil {
		err := videoError(VideoErrorLoad, fmt.Errorf("managed video model is not loaded"))
		return stream.SendMsg(videoTerminalEvent(VideoCandidate{}, err))
	}

	s.videoGenerateMu.Lock()
	defer s.videoGenerateMu.Unlock()
	done := make(chan struct{})
	s.videoStateMu.Lock()
	s.activeVideoDone = done
	s.videoStateMu.Unlock()
	defer func() {
		s.videoStateMu.Lock()
		if s.activeVideoDone == done {
			s.activeVideoDone = nil
		}
		s.videoStateMu.Unlock()
	}()

	type generateResult struct {
		candidate VideoCandidate
		err       error
	}
	resultCh := make(chan generateResult, 1)
	progressCh := make(chan VideoGenerateProgress, 64)
	startedAt := time.Now()
	go func() {
		defer close(done)
		candidate, generateErr := s.videoEngine.Generate(request, func(progress VideoGenerateProgress) {
			select {
			case progressCh <- progress:
			default:
			}
		})
		if candidate.ComputeMS == 0 {
			candidate.ComputeMS = time.Since(startedAt).Milliseconds()
		}
		resultCh <- generateResult{candidate: candidate, err: generateErr}
	}()

	for {
		select {
		case progress := <-progressCh:
			if err := stream.SendMsg(videoProgressEvent(progress)); err != nil {
				_ = s.videoEngine.Cancel()
				<-done
				return err
			}
		case result := <-resultCh:
			if result.err != nil {
				if VideoErrorKindOf(result.err) == "" {
					result.err = videoError(VideoErrorInference, fmt.Errorf("generate video: %w", result.err))
				}
				return stream.SendMsg(videoTerminalEvent(VideoCandidate{}, result.err))
			}
			if err := validateVideoCandidate(request, result.candidate); err != nil {
				return stream.SendMsg(videoTerminalEvent(VideoCandidate{}, err))
			}
			return stream.SendMsg(videoTerminalEvent(result.candidate, nil))
		case <-stream.Context().Done():
			_ = s.videoEngine.Cancel()
			<-done
			return stream.Context().Err()
		}
	}
}

func (s *Server) handleCancelVideo(stream grpc.ServerStream) error {
	request := dynamicpb.NewMessage(cancelVideoRequestDescriptor)
	if err := stream.RecvMsg(request); err != nil {
		return err
	}
	if readUint32Field(request, "protocol_version") != VideoProtocolVersion {
		err := videoError(VideoErrorProtocolMismatch, fmt.Errorf("managed video protocol version mismatch"))
		return stream.SendMsg(protocolErrorResult(err))
	}
	if s.videoEngine == nil {
		err := videoError(VideoErrorCanceled, fmt.Errorf("managed video FFI engine is unavailable"))
		return stream.SendMsg(protocolErrorResult(err))
	}
	s.videoStateMu.Lock()
	done := s.activeVideoDone
	s.videoStateMu.Unlock()
	if done == nil {
		return stream.SendMsg(videoOperationResult(true, "idle", "", false, s.videoPackage.String()))
	}
	if err := s.videoEngine.Cancel(); err != nil {
		err = videoError(VideoErrorCanceled, fmt.Errorf("cancel video engine: %w", err))
		return stream.SendMsg(protocolErrorResult(err))
	}
	select {
	case <-done:
		return stream.SendMsg(videoOperationResult(true, "canceled", "", false, s.videoPackage.String()))
	case <-stream.Context().Done():
		return stream.Context().Err()
	}
}

func shutdownVideoEngine(engine videoEngine) error {
	if engine == nil {
		return nil
	}
	return engine.Free()
}
