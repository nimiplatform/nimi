use super::*;
use crate::generated::{AudioFrameRange, MusicAudioInput, AudioVoiceConvertScenarioSpec, VoiceConversion,
    VoiceConversionLengthRelation, VoiceConvertSourceKind, VoiceConvertTargetVoice};
use crate::generated::voice_convert_target_voice::Target as VoiceConvertTarget;

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion
pub(super) fn parse(object: &Map<String, JsonValue>) -> Result<AudioVoiceConvertScenarioSpec, LocalAppOperationError> {
    // semitoneShift is optional: absence keeps the source key.
    allowed_keys(object, &["type", "sourceVocal", "sourceKind", "targetVoice", "semitoneShift"], &["type", "sourceVocal", "sourceKind", "targetVoice"])?;
    if string_field(object, "sourceKind")? != "singing" { return Err(invalid_payload()); }
    let source = parse_music_audio(field(object, "sourceVocal")?)?;
    let target = field(object, "targetVoice")?.as_object().ok_or_else(invalid_payload)?;
    let target_voice = match string_field(target, "kind")? {
        "reference-audio" => {
            allowed_keys(target, &["kind", "artifactId", "range"], &["kind", "artifactId"])?;
            let artifact_id = required_text_field(target, "artifactId", MAX_IDENTIFIER_BYTES)?;
            require_identifier(&artifact_id).map_err(|_| invalid_payload())?;
            if artifact_id == source.artifact_id { return Err(invalid_payload()); }
            VoiceConvertTargetVoice { target: Some(VoiceConvertTarget::ReferenceAudio(MusicAudioInput { artifact_id, range: parse_range(target)? })) }
        }
        "preset" => {
            allowed_keys(target, &["kind", "presetVoiceId"], &["kind", "presetVoiceId"])?;
            let preset_voice_id = required_text_field(target, "presetVoiceId", MAX_IDENTIFIER_BYTES)?;
            require_identifier(&preset_voice_id).map_err(|_| invalid_payload())?;
            VoiceConvertTargetVoice { target: Some(VoiceConvertTarget::PresetVoiceId(preset_voice_id)) }
        }
        "voice-asset" => {
            allowed_keys(target, &["kind", "voiceAssetId"], &["kind", "voiceAssetId"])?;
            let voice_asset_id = required_text_field(target, "voiceAssetId", MAX_IDENTIFIER_BYTES)?;
            require_identifier(&voice_asset_id).map_err(|_| invalid_payload())?;
            VoiceConvertTargetVoice { target: Some(VoiceConvertTarget::VoiceAssetId(voice_asset_id)) }
        }
        _ => return Err(invalid_payload()),
    };
    let semitone_shift = match object.get("semitoneShift") {
        None => None,
        Some(JsonValue::Number(value)) => {
            let shift = value.as_i64().ok_or_else(invalid_payload)?;
            if !(-12..=12).contains(&shift) { return Err(invalid_payload()); }
            Some(shift as i32)
        }
        Some(_) => return Err(invalid_payload()),
    };
    Ok(AudioVoiceConvertScenarioSpec {
        source_vocal: Some(source), source_kind: VoiceConvertSourceKind::Singing as i32,
        target_voice: Some(target_voice), semitone_shift,
    })
}

pub(super) fn project(value: &VoiceConversion, artifacts: &[LocalAppScenarioArtifact]) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_identifier(&value.vocal_artifact_id)?;
    require_runtime_identifier(&value.source_artifact_id)?;
    if value.vocal_artifact_id == value.source_artifact_id { return Err(untrusted()); }
    let source = value.source_info.as_ref().ok_or_else(untrusted)?;
    let vocal = value.vocal_info.as_ref().ok_or_else(untrusted)?;
    let range = value.input_range.as_ref().ok_or_else(untrusted)?;
    if !(8000..=96000).contains(&source.sample_rate_hz) || !(1..=2).contains(&source.channels)
        || source.frame_count == 0 || source.frame_count > u64::from(source.sample_rate_hz) * 600
        || source.duration_ms != (source.frame_count * 1000 / u64::from(source.sample_rate_hz)) as i64
        || !(8000..=96000).contains(&vocal.sample_rate_hz) || !(1..=2).contains(&vocal.channels)
        || vocal.frame_count == 0 || vocal.frame_count > u64::from(vocal.sample_rate_hz) * 600
        || vocal.duration_ms != (vocal.frame_count * 1000 / u64::from(vocal.sample_rate_hz)) as i64
        || range.end_frame <= range.start_frame || range.end_frame > source.frame_count { return Err(untrusted()); }
    let source_range_duration_ms = ((range.end_frame - range.start_frame) * 1000 / u64::from(source.sample_rate_hz)) as i64;
    if value.duration_delta_ms != vocal.duration_ms - source_range_duration_ms { return Err(untrusted()); }
    let length_relation = match VoiceConversionLengthRelation::try_from(value.length_relation).map_err(|_| untrusted())? {
        VoiceConversionLengthRelation::Exact => {
            if value.duration_delta_ms != 0 { return Err(untrusted()); }
            "EXACT"
        }
        VoiceConversionLengthRelation::ModelFrameRounding => {
            if value.duration_delta_ms.unsigned_abs() >= 1000 { return Err(untrusted()); }
            "MODEL_FRAME_ROUNDING"
        }
        _ => return Err(untrusted()),
    };
    if artifacts.len() != 1 { return Err(untrusted()); }
    let artifact = &artifacts[0];
    if artifact.artifact_id != value.vocal_artifact_id || !artifact.mime_type.starts_with("audio/")
        || artifact.size_bytes <= 0 || artifact.sample_rate_hz as u32 != vocal.sample_rate_hz
        || artifact.channels as u32 != vocal.channels || artifact.duration_ms != vocal.duration_ms { return Err(untrusted()); }
    Ok(json!({"vocalArtifactId": value.vocal_artifact_id, "sourceArtifactId": value.source_artifact_id,
        "sourceInfo": audio_info(source), "inputRange": {"startFrame": range.start_frame, "endFrame": range.end_frame},
        "vocalInfo": audio_info(vocal), "lengthRelation": length_relation, "durationDeltaMs": value.duration_delta_ms}))
}

fn audio_info(value: &crate::generated::LocalAppAudioInfo) -> JsonValue {
    json!({"sampleRateHz": value.sample_rate_hz, "channels": value.channels, "frameCount": value.frame_count, "durationMs": value.duration_ms})
}

fn parse_range(source: &Map<String, JsonValue>) -> Result<Option<AudioFrameRange>, LocalAppOperationError> {
    source.get("range").map(|v| {
        let r = v.as_object().ok_or_else(invalid_payload)?; exact_keys(r, &["startFrame", "endFrame"])?;
        let start_frame = field(r, "startFrame")?.as_u64().ok_or_else(invalid_payload)?;
        let end_frame = field(r, "endFrame")?.as_u64().ok_or_else(invalid_payload)?;
        if end_frame <= start_frame || end_frame > 57_600_000 { return Err(invalid_payload()); }
        Ok(AudioFrameRange { start_frame, end_frame })
    }).transpose()
}

fn parse_music_audio(value: &JsonValue) -> Result<MusicAudioInput, LocalAppOperationError> {
    let source = value.as_object().ok_or_else(invalid_payload)?;
    allowed_keys(source, &["artifactId", "range"], &["artifactId"])?;
    let artifact_id = required_text_field(source, "artifactId", MAX_IDENTIFIER_BYTES)?;
    require_identifier(&artifact_id).map_err(|_| invalid_payload())?;
    Ok(MusicAudioInput { artifact_id, range: parse_range(source)? })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conversion_keeps_the_source_vocal_and_target_voice_distinct() {
        let request = json!({"type":"audio-voice-convert","sourceVocal":{"artifactId":"source-1","range":{"startFrame":48000,"endFrame":144000}},
            "sourceKind":"singing","targetVoice":{"kind":"reference-audio","artifactId":"target-1"},"semitoneShift":3});
        let parsed = parse(request.as_object().unwrap()).unwrap();
        assert_eq!(parsed.semitone_shift, Some(3));
        let mut merged = request.clone();
        merged["targetVoice"]["artifactId"] = json!("source-1");
        assert!(parse(merged.as_object().unwrap()).is_err());
        let mut out_of_range = request.clone(); out_of_range["semitoneShift"] = json!(13);
        assert!(parse(out_of_range.as_object().unwrap()).is_err());
        // The default request keeps the source key and carries no shift.
        let mut unshifted = request.clone(); unshifted.as_object_mut().unwrap().remove("semitoneShift");
        unshifted["targetVoice"]["range"] = json!({"startFrame":88200,"endFrame":264600});
        let parsed = parse(unshifted.as_object().unwrap()).unwrap();
        assert_eq!(parsed.semitone_shift, None);
        match parsed.target_voice.and_then(|voice| voice.target) {
            Some(VoiceConvertTarget::ReferenceAudio(reference)) => assert_eq!(reference.range, Some(AudioFrameRange { start_frame: 88200, end_frame: 264600 })),
            _ => panic!("reference target lost"),
        }
        let mut missing_target = request; missing_target.as_object_mut().unwrap().remove("targetVoice");
        assert!(parse(missing_target.as_object().unwrap()).is_err());
        let value = VoiceConversion {
            vocal_artifact_id: "vocal-1".into(), source_artifact_id: "source-1".into(),
            source_info: Some(crate::generated::LocalAppAudioInfo { sample_rate_hz:48000, channels:2, frame_count:480000, duration_ms:10000 }),
            input_range: Some(AudioFrameRange { start_frame:0, end_frame:480000 }),
            vocal_info: Some(crate::generated::LocalAppAudioInfo { sample_rate_hz:24000, channels:1, frame_count:240828, duration_ms:10034 }),
            length_relation: VoiceConversionLengthRelation::ModelFrameRounding as i32, duration_delta_ms: 34,
        };
        let artifacts: Vec<LocalAppScenarioArtifact> = vec![LocalAppScenarioArtifact { artifact_id:"vocal-1".into(), mime_type:"audio/wav".into(), size_bytes:963400,
            sample_rate_hz:24000, channels:1, duration_ms:10034, ..Default::default() }];
        let output = project(&value, &artifacts).unwrap();
        assert_eq!(output["lengthRelation"], "MODEL_FRAME_ROUNDING");
        assert_eq!(output["durationDeltaMs"], 34);
        assert!(project(&value, &[]).is_err());
        let mut wrong_delta = value; wrong_delta.duration_delta_ms = 0;
        assert!(project(&wrong_delta, &artifacts).is_err());
        // A full 191.635 s song: the delta is the difference of the two
        // published millisecond durations (191670 - 191635), not 34.
        let full = VoiceConversion {
            source_info: Some(crate::generated::LocalAppAudioInfo { sample_rate_hz:44100, channels:2, frame_count:8451125, duration_ms:191635 }),
            input_range: Some(AudioFrameRange { start_frame:0, end_frame:8451125 }),
            vocal_info: Some(crate::generated::LocalAppAudioInfo { sample_rate_hz:24000, channels:1, frame_count:4600080, duration_ms:191670 }),
            duration_delta_ms: 35, ..wrong_delta
        };
        let full_artifacts: Vec<LocalAppScenarioArtifact> = vec![LocalAppScenarioArtifact { artifact_id:"vocal-1".into(), mime_type:"audio/wav".into(), size_bytes:18400378,
            sample_rate_hz:24000, channels:1, duration_ms:191670, ..Default::default() }];
        assert_eq!(project(&full, &full_artifacts).unwrap()["durationDeltaMs"], 35);
        assert!(project(&VoiceConversion { duration_delta_ms: 34, ..full }, &full_artifacts).is_err());
    }
}
