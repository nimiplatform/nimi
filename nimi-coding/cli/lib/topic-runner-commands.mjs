function hasPlaceholder(value) {
  return /<[^>]+>/.test(value);
}

function commandOptionValue(parts, flag) {
  const index = parts.indexOf(flag);
  return index >= 0 ? parts[index + 1] : null;
}

function commandRequiredOption(parts, flag, commandRef, actionLabel) {
  const value = commandOptionValue(parts, flag);
  if (!value || value.startsWith("--")) {
    return {
      ok: false,
      error: `topic-runner refused: ${actionLabel} command is missing ${flag}: ${commandRef}`,
    };
  }
  return { ok: true, value };
}

export function parseMechanicalCommandRef(commandRef, topicId) {
  if (typeof commandRef !== "string" || commandRef.trim().length === 0) {
    return {
      ok: false,
      error: "topic-runner refused: decision.next_command_ref is empty",
    };
  }
  if (hasPlaceholder(commandRef)) {
    return {
      ok: false,
      error: `topic-runner refused: decision.next_command_ref contains a placeholder: ${commandRef}`,
    };
  }

  const parts = commandRef.trim().split(/\s+/);
  if (parts[0] !== "nimicoding" || parts[1] !== "topic") {
    return {
      ok: false,
      error: `topic-runner refused: next command is not a package-owned topic command: ${commandRef}`,
    };
  }

  const [domain, action, commandTopicId] = parts.slice(2, 5);
  if (domain === "wave" && action === "admit") {
    const waveId = parts[5] ?? null;
    if (commandTopicId !== topicId) {
      return {
        ok: false,
        error: `topic-runner refused: next command topic ${commandTopicId} does not match ${topicId}`,
      };
    }
    if (!waveId || waveId.startsWith("--")) {
      return {
        ok: false,
        error: `topic-runner refused: wave admit command is missing wave id: ${commandRef}`,
      };
    }
    return { ok: true, action: "admit_wave", waveId };
  }

  if (domain === "packet" && action === "freeze") {
    if (commandTopicId !== topicId) {
      return {
        ok: false,
        error: `topic-runner refused: next command topic ${commandTopicId} does not match ${topicId}`,
      };
    }
    const draftPath = commandOptionValue(parts, "--from");
    if (!draftPath || draftPath.startsWith("--")) {
      return {
        ok: false,
        error: `topic-runner refused: packet freeze command is missing --from: ${commandRef}`,
      };
    }
    return { ok: true, action: "freeze_packet", draftPath };
  }

  if (domain === "result" && action === "record") {
    if (commandTopicId !== topicId) {
      return {
        ok: false,
        error: `topic-runner refused: next command topic ${commandTopicId} does not match ${topicId}`,
      };
    }
    const required = [
      ["--kind", "result record"],
      ["--verdict", "result record"],
      ["--from", "result record"],
      ["--verified-at", "result record"],
    ].map(([flag, label]) => [flag, commandRequiredOption(parts, flag, commandRef, label)]);
    const failed = required.find(([, check]) => !check.ok);
    if (failed) return failed[1];
    const values = Object.fromEntries(required.map(([flag, check]) => [flag, check.value]));
    return {
      ok: true,
      action: "record_result",
      resultKind: values["--kind"],
      verdict: values["--verdict"],
      fromPath: values["--from"],
      verifiedAt: values["--verified-at"],
    };
  }

  if (["worker", "audit"].includes(domain) && action === "dispatch") {
    if (commandTopicId !== topicId) {
      return {
        ok: false,
        error: `topic-runner refused: next command topic ${commandTopicId} does not match ${topicId}`,
      };
    }
    const packetId = commandOptionValue(parts, "--packet");
    if (!packetId || packetId.startsWith("--")) {
      return {
        ok: false,
        error: `topic-runner refused: dispatch command is missing --packet: ${commandRef}`,
      };
    }
    return {
      ok: true,
      action: domain === "audit" ? "dispatch_audit" : "dispatch_worker",
      role: domain,
      packetId,
    };
  }

  if (domain === "closeout" && action === "wave") {
    if (commandTopicId !== topicId) {
      return {
        ok: false,
        error: `topic-runner refused: next command topic ${commandTopicId} does not match ${topicId}`,
      };
    }
    const waveId = parts[5] ?? null;
    if (!waveId || waveId.startsWith("--")) {
      return {
        ok: false,
        error: `topic-runner refused: closeout wave command is missing wave id: ${commandRef}`,
      };
    }
    const authorityClosure = commandOptionValue(parts, "--authority");
    const semanticClosure = commandOptionValue(parts, "--semantic");
    const consumerClosure = commandOptionValue(parts, "--consumer");
    const driftResistanceClosure = commandOptionValue(parts, "--drift-resistance");
    const disposition = commandOptionValue(parts, "--disposition");
    if (
      !authorityClosure || authorityClosure.startsWith("--") ||
      !semanticClosure || semanticClosure.startsWith("--") ||
      !consumerClosure || consumerClosure.startsWith("--") ||
      !driftResistanceClosure || driftResistanceClosure.startsWith("--") ||
      !disposition || disposition.startsWith("--")
    ) {
      return {
        ok: false,
        error: `topic-runner refused: closeout wave command is missing required closure flags: ${commandRef}`,
      };
    }

    return {
      ok: true,
      action: "closeout_wave",
      waveId,
      authorityClosure,
      semanticClosure,
      consumerClosure,
      driftResistanceClosure,
      disposition,
    };
  }

  return {
    ok: false,
    error: `topic-runner refused: unsupported mechanical next command: ${commandRef}`,
  };
}
