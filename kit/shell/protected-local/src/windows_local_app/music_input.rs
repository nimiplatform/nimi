use serde_json::{json, Value};
use crate::{generated::MusicInputCapabilities, LocalAppOperationError};
use super::untrusted;

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
pub(super) fn project(value: MusicInputCapabilities) -> Result<Value, LocalAppOperationError> {
    if value.generation.len() > 16 || value.transcription.len() > 16 || value.voice_convert.len() > 16
        || (value.generation.is_empty() && value.transcription.is_empty() && value.voice_convert.is_empty()) { return Err(untrusted()); }
    let mut profiles = Vec::new();
    for row in value.generation {
        if !matches!(row.lyrics_mode.as_str(), "unsupported" | "optional" | "required")
            || !matches!(row.score_mode.as_str(), "unsupported" | "required")
            || row.max_duration_seconds == 0 || row.max_duration_seconds > 600
            || row.default_duration_seconds == 0 || row.default_duration_seconds > row.max_duration_seconds
            || row.max_prompt_bytes == 0 || row.max_prompt_bytes > 32768 || row.max_lyrics_bytes > 32768
            || row.max_score_bytes > 1048576 || row.max_audio_reference_bytes > 33554432
            || row.supports_audio_reference != (row.max_audio_reference_bytes > 0)
            || (row.lyrics_mode == "unsupported") != (row.max_lyrics_bytes == 0)
            || (row.lyrics_mode == "required" && row.supports_instrumental)
            || !tokens(&row.score_formats, &["abc", "midi"])
            || !tokens(&row.score_conditioning, &["melody-only", "melody-and-harmony"])
            || (row.score_mode == "required") != (!row.score_formats.is_empty() && !row.score_conditioning.is_empty() && row.max_score_bytes > 0)
            || (row.score_mode == "unsupported" && (!row.score_formats.is_empty() || !row.score_conditioning.is_empty() || row.max_score_bytes != 0)) { return Err(untrusted()); }
        profiles.push(json!({"lyricsMode":row.lyrics_mode,"scoreMode":row.score_mode,"scoreFormats":row.score_formats,
            "scoreConditioning":row.score_conditioning,"supportsInstrumental":row.supports_instrumental,"supportsSeed":row.supports_seed,
            "supportsGeneratedScore":row.supports_generated_score,"supportsAudioReference":row.supports_audio_reference,
            "maxDurationSeconds":row.max_duration_seconds,"defaultDurationSeconds":row.default_duration_seconds,
            "maxPromptBytes":row.max_prompt_bytes,"maxLyricsBytes":row.max_lyrics_bytes,"maxScoreBytes":row.max_score_bytes,
            "maxAudioReferenceBytes":row.max_audio_reference_bytes}));
    }
    let mut transcription = Vec::new();
    for row in value.transcription {
        if row.formats.is_empty() || row.parts.is_empty()
            || !tokens(&row.formats, &["abc", "midi", "timeline"])
            || !tokens(&row.parts, &["vocal-melody", "lead-sheet", "full-arrangement"])
            || row.max_duration_seconds == 0 || row.max_duration_seconds > 600
            || row.max_source_bytes == 0 || row.max_source_bytes > 512 * 1024 * 1024 { return Err(untrusted()); }
        transcription.push(json!({"formats":row.formats,"parts":row.parts,"maxDurationSeconds":row.max_duration_seconds,
            "maxSourceBytes":row.max_source_bytes,"supportsRange":row.supports_range}));
    }
    let mut voice_convert = Vec::new();
    for row in value.voice_convert {
        if row.source_kinds.is_empty() || row.target_kinds.is_empty()
            || !tokens(&row.source_kinds, &["singing"])
            || !tokens(&row.target_kinds, &["reference-audio", "preset", "voice-asset"])
            || row.max_source_seconds == 0 || row.max_source_seconds > 600
            || row.max_target_seconds == 0 || row.max_target_seconds > 600
            || row.min_semitone_shift < -12 || row.min_semitone_shift > 12
            || row.max_semitone_shift < -12 || row.max_semitone_shift > 12
            || row.min_semitone_shift > row.max_semitone_shift
            || row.max_source_bytes == 0 || row.max_source_bytes > 512 * 1024 * 1024
            || row.max_target_bytes == 0 || row.max_target_bytes > 512 * 1024 * 1024 { return Err(untrusted()); }
        voice_convert.push(json!({"sourceKinds":row.source_kinds,"targetKinds":row.target_kinds,
            "maxSourceSeconds":row.max_source_seconds,"maxTargetSeconds":row.max_target_seconds,"supportsRange":row.supports_range,
            "supportsSemitoneShift":row.supports_semitone_shift,"minSemitoneShift":row.min_semitone_shift,"maxSemitoneShift":row.max_semitone_shift,
            "maxSourceBytes":row.max_source_bytes,"maxTargetBytes":row.max_target_bytes}));
    }
    let mut result = json!({"generation":profiles});
    if !transcription.is_empty() { result["transcription"] = json!(transcription); }
    if !voice_convert.is_empty() { result["voiceConvert"] = json!(voice_convert); }
    Ok(result)
}

fn tokens(values: &[String], allowed: &[&str]) -> bool {
    values.len() <= allowed.len() && values.iter().enumerate().all(|(index, item)| allowed.contains(&item.as_str()) && !values[..index].contains(item))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capability_profiles_keep_only_consistent_input_combinations() {
        let profile = crate::generated::MusicGenerationInputProfile {
            lyrics_mode:"required".into(), score_mode:"unsupported".into(), supports_seed:true,
            supports_generated_score:true, max_duration_seconds:600, default_duration_seconds:20,
            max_prompt_bytes:32768, max_lyrics_bytes:32768, ..Default::default()
        };
        let value = MusicInputCapabilities { generation:vec![profile.clone()], ..Default::default() };
        assert_eq!(project(value.clone()).unwrap()["generation"][0]["maxDurationSeconds"],600);
        let mut contradictory=value.clone();contradictory.generation[0].supports_audio_reference=true;
        assert!(project(contradictory).is_err());
        let mut extra_score=value;extra_score.generation[0].score_formats.push("abc".into());
        assert!(project(extra_score).is_err());
    }
}
