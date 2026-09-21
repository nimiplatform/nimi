use super::*;
use crate::generated::{AudioFrameRange, MusicAudioInput, MusicTranscribeScenarioSpec, MusicTranscription,
    MusicTranscriptionFormat, MusicTranscriptionPart, MusicTranscriptionCompleteness, MusicScoreFormat, MusicScoreOrigin};
use std::collections::{HashMap, HashSet};

// @nimi-authority: rule.nimi.runtime.ai-provider.music-transcription
pub(super) fn parse(object: &Map<String, JsonValue>) -> Result<MusicTranscribeScenarioSpec, LocalAppOperationError> {
    exact_keys(object, &["type", "sourceAudio", "requestedFormats", "requestedParts"])?;
    let source = field(object, "sourceAudio")?.as_object().ok_or_else(invalid_payload)?;
    allowed_keys(source, &["artifactId", "range"], &["artifactId"])?;
    let artifact_id = required_text_field(source, "artifactId", MAX_IDENTIFIER_BYTES)?;
    require_identifier(&artifact_id).map_err(|_| invalid_payload())?;
    let range = source.get("range").map(|v| {
        let r = v.as_object().ok_or_else(invalid_payload)?; exact_keys(r, &["startFrame", "endFrame"])?;
        let start_frame = field(r, "startFrame")?.as_u64().ok_or_else(invalid_payload)?;
        let end_frame = field(r, "endFrame")?.as_u64().ok_or_else(invalid_payload)?;
        if end_frame <= start_frame || end_frame > 57_600_000 { return Err(invalid_payload()); }
        Ok(AudioFrameRange { start_frame, end_frame })
    }).transpose()?;
    let formats = field(object, "requestedFormats")?.as_array().ok_or_else(invalid_payload)?;
    let parts = field(object, "requestedParts")?.as_array().ok_or_else(invalid_payload)?;
    if formats.is_empty() || formats.len() > 3 || parts.is_empty() || parts.len() > 3 { return Err(invalid_payload()); }
    let requested_formats = formats.iter().map(|v| match v.as_str() {
        Some("abc") => Ok(MusicTranscriptionFormat::Abc as i32), Some("midi") => Ok(MusicTranscriptionFormat::Midi as i32),
        Some("timeline") => Ok(MusicTranscriptionFormat::Timeline as i32), _ => Err(invalid_payload()),
    }).collect::<Result<Vec<_>, _>>()?;
    let requested_parts = parts.iter().map(|v| match v.as_str() {
        Some("vocal-melody") => Ok(MusicTranscriptionPart::VocalMelody as i32), Some("lead-sheet") => Ok(MusicTranscriptionPart::LeadSheet as i32),
        Some("full-arrangement") => Ok(MusicTranscriptionPart::FullArrangement as i32), _ => Err(invalid_payload()),
    }).collect::<Result<Vec<_>, _>>()?;
    if requested_formats.iter().collect::<HashSet<_>>().len() != formats.len() || requested_parts.iter().collect::<HashSet<_>>().len() != parts.len() { return Err(invalid_payload()); }
    Ok(MusicTranscribeScenarioSpec { source_audio: Some(MusicAudioInput { artifact_id, range }), requested_formats, requested_parts })
}

pub(super) fn project(value: &MusicTranscription, artifacts: &[LocalAppScenarioArtifact]) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_identifier(&value.source_artifact_id)?;
    let info = value.source_info.as_ref().ok_or_else(untrusted)?; let range = value.input_range.as_ref().ok_or_else(untrusted)?;
    if value.origin != MusicScoreOrigin::TranscribedEstimate as i32 || !(8000..=96000).contains(&info.sample_rate_hz) || !(1..=2).contains(&info.channels)
        || info.frame_count == 0 || info.frame_count > u64::from(info.sample_rate_hz) * 600 || info.duration_ms != (info.frame_count * 1000 / u64::from(info.sample_rate_hz)) as i64
        || range.end_frame <= range.start_frame || range.end_frame > info.frame_count || value.scores.len() > 6 { return Err(untrusted()); }
    let completeness = match MusicTranscriptionCompleteness::try_from(value.completeness).map_err(|_| untrusted())? {
        MusicTranscriptionCompleteness::Unknown => "unknown", MusicTranscriptionCompleteness::Complete => "complete",
        MusicTranscriptionCompleteness::Truncated => "truncated", _ => return Err(untrusted()),
    };
    let mut expected = HashMap::new(); let mut pairs = HashSet::new(); let mut scores = Vec::new();
    for score in &value.scores {
        require_runtime_identifier(&score.artifact_id)?;
        let (format, mime, max) = match MusicScoreFormat::try_from(score.format).map_err(|_| untrusted())? {
            MusicScoreFormat::Abc => ("abc", "text/vnd.abc", 1_048_576_i64), MusicScoreFormat::Midi => ("midi", "audio/midi", 16_777_216_i64), _ => return Err(untrusted()),
        };
        let part = match MusicTranscriptionPart::try_from(score.part).map_err(|_| untrusted())? {
            MusicTranscriptionPart::VocalMelody => "vocal-melody", MusicTranscriptionPart::LeadSheet => "lead-sheet", MusicTranscriptionPart::FullArrangement => "full-arrangement", _ => return Err(untrusted()),
        };
        if expected.insert(score.artifact_id.as_str(), (mime, max)).is_some() || !pairs.insert((score.format, score.part)) { return Err(untrusted()); }
        scores.push(json!({"artifactId":score.artifact_id,"format":format,"part":part}));
    }
    if !value.timeline_artifact_id.is_empty() {
        require_runtime_identifier(&value.timeline_artifact_id)?;
        if expected.insert(value.timeline_artifact_id.as_str(), ("application/vnd.nimi.music-timeline+json", 16_777_216_i64)).is_some() { return Err(untrusted()); }
    }
    if expected.is_empty() || expected.len() != artifacts.len() { return Err(untrusted()); }
    for artifact in artifacts {
        let (mime, max) = expected.remove(artifact.artifact_id.as_str()).ok_or_else(untrusted)?;
        if artifact.mime_type != mime || !(1..=max).contains(&artifact.size_bytes) { return Err(untrusted()); }
    }
    let mut output = json!({"scores":scores,"origin":"transcribed-estimate","sourceArtifactId":value.source_artifact_id,
        "sourceInfo":{"sampleRateHz":info.sample_rate_hz,"channels":info.channels,"frameCount":info.frame_count,"durationMs":info.duration_ms},
        "inputRange":{"startFrame":range.start_frame,"endFrame":range.end_frame},"completeness":completeness});
    if !value.timeline_artifact_id.is_empty() { output["timelineArtifactId"] = json!(value.timeline_artifact_id); }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transcription_keeps_source_range_and_rejects_missing_artifacts() {
        let request = json!({"type":"music-transcribe","sourceAudio":{"artifactId":"source-1","range":{"startFrame":48000,"endFrame":144000}},"requestedFormats":["abc","timeline"],"requestedParts":["lead-sheet"]});
        let parsed = parse(request.as_object().unwrap()).unwrap();
        assert_eq!(parsed.source_audio.unwrap().range.unwrap().start_frame, 48000);
        let mut duplicate = request.clone(); duplicate["requestedFormats"] = json!(["abc","abc"]);
        assert!(parse(duplicate.as_object().unwrap()).is_err());
        let mut private = request; private["model"] = json!("sheetsage2");
        assert!(parse(private.as_object().unwrap()).is_err());
        let value = MusicTranscription {
            source_artifact_id: "source-1".into(), source_info: Some(crate::generated::LocalAppAudioInfo { sample_rate_hz:48000, channels:2, frame_count:144000, duration_ms:3000 }),
            input_range: Some(AudioFrameRange { start_frame:48000, end_frame:144000 }), origin:MusicScoreOrigin::TranscribedEstimate as i32,
            completeness:MusicTranscriptionCompleteness::Unknown as i32,
            scores:vec![crate::generated::MusicTranscribedScore { artifact_id:"score-1".into(), format:MusicScoreFormat::Abc as i32, part:MusicTranscriptionPart::LeadSheet as i32 }], timeline_artifact_id:"events-1".into(),
        };
        let artifacts: Vec<LocalAppScenarioArtifact> = [("score-1", "text/vnd.abc"), ("events-1", "application/vnd.nimi.music-timeline+json")].into_iter().map(|(id,mime)| LocalAppScenarioArtifact { artifact_id:id.into(), mime_type:mime.into(), size_bytes:512, ..Default::default() }).collect();
        let output = project(&value, &artifacts).unwrap();
        assert_eq!(output["inputRange"]["startFrame"], 48000);
        assert_eq!(output["completeness"], "unknown");
        assert_eq!(output["origin"], "transcribed-estimate");
        assert!(project(&value, &artifacts[..1]).is_err());
        let mut invalid = value; invalid.input_range.as_mut().unwrap().end_frame += 1;
        assert!(project(&invalid, &artifacts).is_err());
    }
}
