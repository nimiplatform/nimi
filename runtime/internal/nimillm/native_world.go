package nimillm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// One observation discovers the original World's required output set. It does
// not download a splat, panorama, collider or archive body.
func observeNativeWorld(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	var world map[string]any
	var artifacts []*runtimev1.ScenarioArtifact
	if r.Adapter == AdapterSpaitialNative {
		if !validSpaitialID(r.TaskID) || r.Model != "default" {
			return nil, false, spaitialOutputError("original World identity invalid")
		}
		state := map[string]any{}
		if err := spaitialJSON(ctx, cfg, http.MethodGet, "/v1/worlds/requests/"+r.TaskID+"/status", nil, "", &state); err != nil {
			return nil, false, err
		}
		if id, present := state["request_id"]; present && id != r.TaskID {
			return nil, false, spaitialOutputError("status identity mismatch")
		}
		switch state["status"] {
		case "PENDING", "PROCESSING":
			return nil, false, nil
		case "FAILED":
			return nil, true, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
		case "CANCELLED":
			return nil, true, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED)
		case "COMPLETED":
		default:
			return nil, false, spaitialOutputError("unrecognized provider status")
		}
		world = map[string]any{}
		if err := spaitialJSON(ctx, cfg, http.MethodGet, "/v1/worlds/requests/"+r.TaskID, nil, "", &world); err != nil {
			return nil, false, err
		}
		plan, err := prepareSpaitialWorldAcquisition(cfg, world, r.TaskID, r.Model)
		if err != nil {
			return nil, false, err
		}
		artifacts = plan.artifacts
		artifacts[0].Bytes = plan.manifest
	} else {
		headers := cloneMediaHeaders(cfg.Headers)
		if headers == nil {
			headers = map[string]string{}
		}
		headers["WLT-Api-Key"] = cfg.APIKey
		state := map[string]any{}
		if err := DoJSONRequestWithHeaders(ctx, http.MethodGet, JoinURL(cfg.BaseURL, "/marble/v1/operations/"+url.PathEscape(r.TaskID)), "", nil, &state, headers); err != nil {
			return nil, false, err
		}
		if !ValueAsBool(state["done"]) {
			return nil, false, nil
		}
		if err := worldLabsOperationError(state); err != nil {
			return nil, true, err
		}
		var err error
		world, err = fetchWorldLabsWorld(ctx, cfg.BaseURL, headers, state)
		if err != nil {
			return nil, false, err
		}
		raw, metadata, err := buildWorldLabsManifest(world, r.TaskID)
		if err != nil {
			return nil, false, err
		}
		artifacts = []*runtimev1.ScenarioArtifact{BinaryArtifact(worldLabsManifestMIME, raw, metadata), BinaryArtifact(WorldBundleMIME, nil, map[string]any{"world_id": world["world_id"]})}
	}
	artifacts[0].ArtifactId = r.Artifact.GetArtifactId()
	artifacts[1].ArtifactId = r.Artifact.GetArtifactId() + "-bundle"
	artifacts[1].Sha256 = ""
	raw, err := json.Marshal(world)
	if err != nil || len(raw) > maxJSONOrBinaryResponseBytes {
		return nil, false, fmt.Errorf("World acquisition control envelope invalid")
	}
	return &NativeTaskObservation{Artifacts: artifacts, WorldPayload: raw}, true, nil
}

// Called only after body-set admission. Every proxy and asset request still
// passes its fresh outbound gate using the original captured Connector.
func openNativeWorld(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt, observation *NativeTaskObservation) (map[string]*MediaArtifactBody, error) {
	if len(observation.Artifacts) != 2 {
		return nil, fmt.Errorf("incomplete World body set")
	}
	var world map[string]any
	if err := json.Unmarshal(observation.WorldPayload, &world); err != nil {
		return nil, err
	}
	if r.Adapter == AdapterSpaitialNative {
		result, err := normalizeSpaitialWorldResponse(ctx, cfg, world, r.TaskID, r.Model)
		if err != nil {
			return nil, err
		}
		bodies := make(map[string]*MediaArtifactBody, 2)
		for i, artifact := range result.Artifacts {
			bodies[observation.Artifacts[i].GetArtifactId()] = result.ArtifactBodies[artifact.GetArtifactId()]
			observation.Artifacts[i].Bytes = nil
		}
		return bodies, nil
	}
	bundle, err := buildWorldLabsBundle(ctx, world)
	if err != nil {
		return nil, err
	}
	manifest := observation.Artifacts[0]
	bodies := map[string]*MediaArtifactBody{manifest.GetArtifactId(): {Bytes: manifest.GetBytes()}, observation.Artifacts[1].GetArtifactId(): {Bytes: bundle}}
	manifest.Bytes = nil
	observation.Artifacts[1].SizeBytes = int64(len(bundle))
	return bodies, nil
}
