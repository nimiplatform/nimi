# Safety declaration

`nimi.app.yaml` `safety_profile` is the only author input for the App's safety declaration. It states, for the exact version being released, what the App actually provides: intended audience, content descriptors, AI interaction and output facts with the current presence of notices and markings, bounded data/sharing/account/commercial practices, and high-impact decision uses. App Tools projects it one way into `app-info.json`, the archive declaration, the exact sidecar and the candidate; do not maintain a second copy in `.nimi/admission/submission.yaml` — sync regenerates that copy and check rejects a hand-edited one.

Omit the field entirely while it is not yet declared. Absence means undeclared; it is never an empty risk list or a platform safety default. Local dev, test, build and pack, private packages and local import stay usable without it. New public Registry admission requires the complete declaration, so declare it before preparing a public submission.

Declare facts, not proofs. `absent` is a legitimate value for a notice or marking, and `present` means the supported paths uniformly provide it (declare `absent` when only some do). Audience is publisher positioning, not legal age verification. Descriptors cover provided functionality, default content and reasonably foreseeable ordinary use, not every possible model output. Capability names never imply declaration values: a `voice.create` reference does not require an `audio` output entry or a voice-replication risk feature. Do not add marking code, scanners, age checks or business SDK calls to satisfy the declaration.

Shape (every field is required when the block is present; lists may be empty; unknown keys are rejected):

```yaml
safety_profile:
  intended_audience: general            # children | general | teen | adult
  content_descriptors: []               # sexual-content, violence, self-harm, drugs-alcohol, gambling, hate-harassment, frightening-content, strong-language, unmoderated-shared-content
  ai:
    direct_interaction: true            # interaction_notice is present|absent when true, not-applicable when false
    interaction_notice: absent
    risk_features: []                   # realistic-face-manipulation, realistic-voice-replication, emotion-recognition, biometric-categorization
    subject_notice: not-applicable      # present|absent only with emotion-recognition or biometric-categorization
    outputs:                            # at most one entry per modality; empty when the App produces no AI output
      - modality: text                  # text | image | audio | video | virtual-scene
        exposure: exportable            # in-app-only | exportable | publishable
        publication_control: not-applicable   # user-confirmed|automatic only for publishable
        in_product_notice: absent       # present | absent
        export_visible_marking: absent  # present | absent; not-applicable only for in-app-only
        machine_readable_marking: absent
  data_practices:
    publisher_direct_external_network: false   # publisher-controlled network outside Nimi-owned carriers
    telemetry: []                       # crash-diagnostics, usage-analytics
    third_party_account: none           # none | optional | required
    user_content_sharing: none          # none | private | public
    commercial_features: []             # purchase, subscription, advertising
    sensitive_data_categories: []       # precise-location, contacts, health, financial, biometric, government-identifier
  high_impact_decision_uses: []         # medical-diagnosis-treatment, legal-decision-support, employment-decision, education-admission-decision, credit-insurance-decision, biometric-identification, public-safety-decision
```

Cross-target differences merge into one declaration: union the lists, choose the more open exposure, prefer `automatic` over `user-confirmed`, and use the conservative `absent` for notices and markings. Update only the fields whose facts changed; unchanged facts need no new material. Structure and version consistency are checked by tools; the truth of the declaration is the publisher's responsibility and is reviewed against concrete evidence, not proven exhaustively.
