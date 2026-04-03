package nimillm

import "testing"

func TestBinaryArtifactPersistsMetadataStruct(t *testing.T) {
	artifact := BinaryArtifact("image/png", []byte("png"), map[string]any{
		"adapter":               "local",
		"prompt":                "orange cat",
		"local.applied_options": []string{"step", "mode"},
		"local.ignored_options": []string{"guidance_scale", "strength"},
	})

	if artifact.GetMetadata() == nil {
		t.Fatal("expected metadata struct")
	}
	if got := artifact.GetMetadata().Fields["adapter"].GetStringValue(); got != "local" {
		t.Fatalf("adapter = %q, want local", got)
	}
	applied := artifact.GetMetadata().Fields["local.applied_options"].GetListValue().GetValues()
	if len(applied) != 2 || applied[0].GetStringValue() != "step" || applied[1].GetStringValue() != "mode" {
		t.Fatalf("local.applied_options = %#v, want [step mode]", applied)
	}
	ignored := artifact.GetMetadata().Fields["local.ignored_options"].GetListValue().GetValues()
	if len(ignored) != 2 || ignored[0].GetStringValue() != "guidance_scale" || ignored[1].GetStringValue() != "strength" {
		t.Fatalf("local.ignored_options = %#v, want [guidance_scale strength]", ignored)
	}
}
