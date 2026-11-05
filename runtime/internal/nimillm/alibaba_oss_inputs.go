package nimillm

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ossmedia"
)

type alibabaUploadedInputURLsKey struct{}

func AlibabaVideoRequiresOSS(spec *runtimev1.VideoGenerateScenarioSpec) bool {
	for _, item := range spec.GetContent() {
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF && (item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO || item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO) {
			return true
		}
	}
	return false
}

func OSSObjectsForMedia(config ossmedia.Config, jobID string, references []CloudVideoMediaReference) ([]OSSInputObject, error) {
	var objects []OSSInputObject
	for _, reference := range references {
		if !strings.HasPrefix(reference.Reference.MIMEType, "audio/") && !strings.HasPrefix(reference.Reference.MIMEType, "video/") {
			continue
		}
		object, err := OSSObjectForInput(config, jobID, reference.ContentIndex, reference.Reference.SHA256)
		if err != nil {
			return nil, err
		}
		objects = append(objects, object)
	}
	return objects, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.oss-input-storage
func PrepareAlibabaOSSInputs(ctx context.Context, client *OSSInputClient, jobID string) (context.Context, []OSSInputObject, error) {
	references, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
	if err := client.RequireUnversionedBucket(ctx); err != nil {
		return ctx, nil, err
	}
	urls := map[int]string{}
	var attempted []OSSInputObject
	for _, reference := range references {
		if !strings.HasPrefix(reference.Reference.MIMEType, "audio/") && !strings.HasPrefix(reference.Reference.MIMEType, "video/") {
			continue
		}
		object, err := OSSObjectForInput(client.config, jobID, reference.ContentIndex, reference.Reference.SHA256)
		if err != nil {
			return ctx, attempted, err
		}
		attempted = append(attempted, object)
		location, err := client.Upload(ctx, object, reference.Reference.Bytes, reference.Reference.MIMEType)
		if err != nil {
			return ctx, attempted, err
		}
		urls[reference.ContentIndex] = location
	}
	return context.WithValue(ctx, alibabaUploadedInputURLsKey{}, urls), attempted, nil
}
