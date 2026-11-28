package managedimagebackend

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/dynamicpb"
)

// @nimi-authority: rule.nimi.runtime.local-compute.r067
// The model-family marker alone cannot establish compatibility with the C
// struct layouts and function signatures compiled into the native bridges.
// Reuse the materializer's existing verified archive identity.
const stableDiffusionVideoArchiveSHA256 = "cd62cb294132e175ca17024d997b8925888438c2d4bdb72968f61935dcdab68e" // pragma: allowlist secret -- public archive checksum

const stableDiffusionVideoDarwinArchiveSHA256 = "f354db28227615974edec21cf64df336f0312a11279fe7574f23c9d622afe226"      // pragma: allowlist secret -- public archive checksum
const stableDiffusionVideoDarwinMetalArchiveSHA256 = "3d7a24780f8193d3835849549b088b34a2de65f5ca0981540caf4a06900a42c9" // pragma: allowlist secret -- source-development archive checksum

type videoPackageIdentity struct {
	Name                   string   `json:"name,omitempty"`
	Alias                  string   `json:"alias,omitempty"`
	SupportedModelFamilies []string `json:"supported_model_families,omitempty"`
	ArchiveSHA256          string   `json:"archive_sha256,omitempty"`
}

func (identity videoPackageIdentity) String() string {
	if strings.TrimSpace(identity.Name) != "" {
		return strings.TrimSpace(identity.Name)
	}
	return strings.TrimSpace(identity.Alias)
}

func (identity videoPackageIdentity) supportsRecipe(recipe string) bool {
	if identity.ArchiveSHA256 == stableDiffusionVideoDarwinArchiveSHA256 || identity.ArchiveSHA256 == stableDiffusionVideoDarwinMetalArchiveSHA256 {
		return recipe == "hyperflow-h3-flash"
	}
	if identity.ArchiveSHA256 != stableDiffusionVideoArchiveSHA256 {
		return false
	}
	// Family labels are a snapshot from installation, not the current Driver
	// support contract. The Host admits the recipe against its current package
	// catalog and verifies the installed payload before starting this wrapper.
	// Bind the wrapper's implemented recipes to the exact native ABI instead.
	return recipe == "minimax-h3" || recipe == "hyperflow-h3-flash" || recipe == "wan22-ti2v-5b"
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

func (s *Server) handleLoadVideoModel(stream grpc.ServerStream) error {
	requestMessage := dynamicpb.NewMessage(loadVideoModelRequestDescriptor)
	if err := stream.RecvMsg(requestMessage); err != nil {
		return err
	}
	request, err := decodeVideoModelRequest(requestMessage)
	if err != nil {
		return stream.SendMsg(protocolErrorResult(err))
	}
	if !s.videoPackage.supportsRecipe(request.RecipeID) {
		err := videoError(VideoErrorEngineIncompatible, fmt.Errorf("managed backend package %q does not match the pinned video ABI for recipe %q", s.videoPackage.String(), request.RecipeID))
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
	if !s.videoPackage.supportsRecipe("hyperflow-h3-flash") {
		err := videoError(VideoErrorEngineIncompatible, fmt.Errorf("managed backend package %q does not match the pinned video ABI", s.videoPackage.String()))
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
	ctx, cancel := context.WithCancel(stream.Context())
	done := make(chan struct{})
	s.videoStateMu.Lock()
	s.activeVideoDone, s.activeVideoCancel = done, cancel
	s.videoStateMu.Unlock()
	defer func() {
		cancel()
		s.videoStateMu.Lock()
		s.activeVideoDone, s.activeVideoCancel = nil, nil
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
		candidate, generateErr := s.videoEngine.Generate(ctx, request, func(progress VideoGenerateProgress) {
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
				_, _ = s.cancelActiveVideo()
				<-done
				return err
			}
		case result := <-resultCh:
			if ctx.Err() != nil {
				return stream.SendMsg(videoTerminalEvent(VideoCandidate{}, videoError(VideoErrorCanceled, ctx.Err())))
			}
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
			_, _ = s.cancelActiveVideo()
			<-done
			return stream.Context().Err()
		}
	}
}

func (s *Server) cancelActiveVideo() (<-chan struct{}, error) {
	s.videoStateMu.Lock()
	defer s.videoStateMu.Unlock()
	if s.activeVideoDone == nil {
		return nil, nil
	}
	// Cancel the captured request even if its worker has not entered native generation yet.
	s.activeVideoCancel()
	return s.activeVideoDone, s.videoEngine.Cancel()
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
	done, err := s.cancelActiveVideo()
	if err != nil {
		return stream.SendMsg(protocolErrorResult(videoError(VideoErrorCanceled, fmt.Errorf("cancel video engine: %w", err))))
	}
	if done == nil {
		return stream.SendMsg(videoOperationResult(true, "idle", "", false, s.videoPackage.String()))
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
