use super::*;
use crate::generated::{AudioFrameRange, MusicAudioInput, MusicGeneration, MusicGenerationTermination,
    MusicScoreConditioning, MusicScoreFormat, MusicScoreOrigin, MusicScoreReference};

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
pub(super) fn parse(object: &Map<String, JsonValue>) -> Result<LocalAppMusicGenerateJobSpec, LocalAppOperationError> {
    allowed_keys(object, &["type", "prompt", "lyrics", "durationSeconds", "instrumental", "seed", "score", "scoreConditioning", "returnGeneratedScore", "audioReference"], &["type", "prompt", "lyrics"])?;
    let prompt = content(object, "prompt")?;
    let lyrics = content(object, "lyrics")?;
    let instrumental = optional_bool_field(object, "instrumental")?.unwrap_or(false);
    if prompt.trim().is_empty() || (instrumental && !lyrics.trim().is_empty()) { return Err(invalid_payload()); }
    let duration = optional_integer_field(object, "durationSeconds")?;
    if duration.is_some_and(|value| !(1..=600).contains(&value)) { return Err(invalid_payload()); }
    let seed = optional_integer_field(object, "seed")?.map(u32::try_from).transpose().map_err(|_| invalid_payload())?;
    let score = object.get("score").map(|value| {
        let value = value.as_object().ok_or_else(invalid_payload)?;
        exact_keys(value, &["artifactId", "format"])?;
        let artifact_id = required_text_field(value, "artifactId", MAX_IDENTIFIER_BYTES)?;
        require_identifier(&artifact_id).map_err(|_| invalid_payload())?;
        let format = match string_field(value, "format")? {
            "abc" => MusicScoreFormat::Abc, "midi" => MusicScoreFormat::Midi, _ => return Err(invalid_payload()),
        };
        Ok(MusicScoreReference { artifact_id, format: format as i32 })
    }).transpose()?;
    let score_conditioning = match (score.is_some(), object.get("scoreConditioning")) {
        (false, None) => MusicScoreConditioning::Unspecified,
        (true, Some(value)) if value.as_str() == Some("melody-only") => MusicScoreConditioning::MelodyOnly,
        (true, Some(value)) if value.as_str() == Some("melody-and-harmony") => MusicScoreConditioning::MelodyAndHarmony,
        _ => return Err(invalid_payload()),
    };
    let audio_reference = object.get("audioReference").map(|value| {
        let value = value.as_object().ok_or_else(invalid_payload)?;
        allowed_keys(value, &["artifactId", "range"], &["artifactId"])?;
        let artifact_id = required_text_field(value, "artifactId", MAX_IDENTIFIER_BYTES)?;
        require_identifier(&artifact_id).map_err(|_| invalid_payload())?;
        let range = value.get("range").map(|range| {
            let range = range.as_object().ok_or_else(invalid_payload)?;
            exact_keys(range, &["startFrame", "endFrame"])?;
            let start_frame = field(range, "startFrame")?.as_u64().ok_or_else(invalid_payload)?;
            let end_frame = field(range, "endFrame")?.as_u64().ok_or_else(invalid_payload)?;
            if start_frame >= end_frame || end_frame > 57_600_000 { return Err(invalid_payload()); }
            Ok(AudioFrameRange { start_frame, end_frame })
        }).transpose()?;
        Ok(MusicAudioInput { artifact_id, range })
    }).transpose()?;
    Ok(LocalAppMusicGenerateJobSpec {
        prompt, lyrics, duration_seconds: duration.unwrap_or(0) as u32, instrumental, seed, score,
        score_conditioning: score_conditioning as i32,
        return_generated_score: optional_bool_field(object, "returnGeneratedScore")?.unwrap_or(false), audio_reference,
    })
}

fn content(object: &Map<String, JsonValue>, key: &str) -> Result<String, LocalAppOperationError> {
    let value = string_field(object, key)?;
    if value.len() > MAX_PROMPT_BYTES || value.chars().any(|ch| ch.is_control() && !matches!(ch, '\r' | '\n' | '\t')) { return Err(invalid_payload()); }
    Ok(value.to_owned())
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
pub(super) fn project(value: &MusicGeneration, artifacts: &[LocalAppScenarioArtifact]) -> Result<JsonValue, LocalAppOperationError> {
    require_runtime_identifier(&value.mix_artifact_id)?;
    let info = value.audio_info.as_ref().ok_or_else(untrusted)?;
    if !(8000..=96000).contains(&info.sample_rate_hz) || !(1..=2).contains(&info.channels)
        || info.frame_count == 0 || info.frame_count > u64::from(info.sample_rate_hz) * 600
        || info.duration_ms != (info.frame_count * 1000 / u64::from(info.sample_rate_hz)) as i64
        || artifacts.len() != if value.generated_score.is_some() { 2 } else { 1 } { return Err(untrusted()); }
    let mix = artifacts.iter().find(|artifact| artifact.artifact_id == value.mix_artifact_id).ok_or_else(untrusted)?;
    if mix.mime_type != "audio/wav" || mix.frame_count != info.frame_count || mix.sample_rate_hz != info.sample_rate_hz as i32
        || mix.channels != info.channels as i32 || mix.duration_ms != info.duration_ms
        || mix.size_bytes < (info.frame_count * u64::from(info.channels) * 4 + 56) as i64 || mix.size_bytes > 512 * 1024 * 1024 { return Err(untrusted()); }
    let termination = match MusicGenerationTermination::try_from(value.termination).map_err(|_| untrusted())? {
        MusicGenerationTermination::Unknown => "unknown", MusicGenerationTermination::ModelEnd => "model-end",
        MusicGenerationTermination::BudgetLimit => "budget-limit", _ => return Err(untrusted()),
    };
    let mut output = json!({"mixArtifactId": value.mix_artifact_id, "termination": termination,
        "audioInfo": {"sampleRateHz": info.sample_rate_hz, "channels": info.channels, "frameCount": info.frame_count, "durationMs": info.duration_ms}});
    if let Some(seed) = value.actual_seed { output["actualSeed"] = json!(seed); }
    if let Some(score) = &value.generated_score {
        require_runtime_identifier(&score.artifact_id)?;
        if score.artifact_id == value.mix_artifact_id || score.format != MusicScoreFormat::Abc as i32 || score.origin != MusicScoreOrigin::GeneratedPlan as i32 { return Err(untrusted()); }
        let artifact = artifacts.iter().find(|artifact| artifact.artifact_id == score.artifact_id).ok_or_else(untrusted)?;
        if artifact.mime_type != "text/vnd.abc" || !(1..=1048576).contains(&artifact.size_bytes) { return Err(untrusted()); }
        output["generatedScore"] = json!({"artifactId": score.artifact_id, "format": "abc", "origin": "generated-plan", "truncated": score.truncated});
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completed_native_music3_facts_cross_the_full_job_projection() {
        // Numeric facts and format from the real Lab result; no inference is simulated here.
        let mix = LocalAppScenarioArtifact { artifact_id:"01M31XPDSR0XFQJVY8NSBQRVED".into(), mime_type:"audio/wav".into(),
            sha256:"4e848edd82bf57a886b92f566020703b9252fb5e583c4751326394e4f120a8ed".into(), size_bytes:7049274, // pragma: allowlist secret -- audio fixture SHA-256
            sample_rate_hz:44100, channels:2, frame_count:881152, duration_ms:19980, ..Default::default() };
        let generation = MusicGeneration { mix_artifact_id:mix.artifact_id.clone(), actual_seed:Some(42),
            termination:MusicGenerationTermination::Unknown as i32,
            audio_info:Some(crate::generated::LocalAppAudioInfo { sample_rate_hz:44100, channels:2, frame_count:881152, duration_ms:19980 }), ..Default::default() };
        assert!(project(&generation, &[mix.clone()]).is_ok());
        let value = LocalAppScenarioJob { job_id:"01M31XMC5XET6EEWQ1CSAX958F".into(), scenario_type:ScenarioType::MusicGenerate as i32,
            status:ScenarioJobStatus::Completed as i32, reason_code:crate::generated::ReasonCode::ActionExecuted as i32,
            trace_id:"01M31XMC5XET6EEWQ1CSAX958F".into(), artifacts:vec![mix], music_generation:Some(generation),
            created_at:Some(prost_types::Timestamp { seconds:1790000000,nanos:581752400 }),
            updated_at:Some(prost_types::Timestamp { seconds:1790000067,nanos:838649200 }),
            recovery_expires_at:Some(prost_types::Timestamp { seconds:1790086467,nanos:838649200 }), ..Default::default() };
        let result = project_job(value).expect("full protected music Job");
        assert_eq!(result["musicGeneration"]["audioInfo"]["frameCount"],881152);
    }
    #[test]
    fn typed_music_inputs_preserve_content_and_reject_orphan_conditions() {
        let value = json!({"type":"music-generate", "prompt":" gentle piano\n", "lyrics":" verse\n\nchorus ", "durationSeconds":240,
            "seed":4294967295_u64, "score":{"artifactId":"score-1","format":"abc"}, "scoreConditioning":"melody-only"});
        let parsed = parse(value.as_object().unwrap()).unwrap();
        assert_eq!(parsed.lyrics, " verse\n\nchorus ");
        assert_eq!(parsed.seed, Some(u32::MAX));
        let mut orphan = value.clone(); orphan.as_object_mut().unwrap().remove("score");
        assert!(parse(orphan.as_object().unwrap()).is_err());
        let mut fractional = value.clone(); fractional["seed"] = json!(0.5);
        assert!(parse(fractional.as_object().unwrap()).is_err());
    }
    #[test]
    fn completed_music_requires_the_entire_consistent_artifact_set() {
        let mix = LocalAppScenarioArtifact { artifact_id:"mix-1".into(), mime_type:"audio/wav".into(), size_bytes:384058,
            sample_rate_hz:48000, channels:2, frame_count:48000, duration_ms:1000, ..Default::default() };
        let mut value = MusicGeneration { mix_artifact_id:"mix-1".into(), termination:MusicGenerationTermination::BudgetLimit as i32,
            audio_info:Some(crate::generated::LocalAppAudioInfo { sample_rate_hz:48000, channels:2, frame_count:48000, duration_ms:1000 }), ..Default::default() };
        assert_eq!(project(&value, &[mix.clone()]).unwrap()["termination"], "budget-limit");
        value.generated_score = Some(crate::generated::MusicScoreArtifact { artifact_id:"score-1".into(), format:MusicScoreFormat::Abc as i32, origin:MusicScoreOrigin::GeneratedPlan as i32, truncated:false });
        assert!(project(&value, &[mix.clone()]).is_err());
        let score = LocalAppScenarioArtifact { artifact_id:"score-1".into(), mime_type:"text/vnd.abc".into(), size_bytes:30, ..Default::default() };
        assert!(project(&value, &[mix, score]).is_ok());
    }
}
