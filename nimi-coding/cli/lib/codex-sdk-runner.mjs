function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return `${field} must be a non-empty string`;
  }
  return null;
}

function normalizeCodexResult(result) {
  return {
    raw: result,
    finalResponse: typeof result?.final_response === "string"
      ? result.final_response
      : typeof result?.finalResponse === "string"
        ? result.finalResponse
        : typeof result === "string"
          ? result
          : null,
  };
}

async function loadCodexSdk() {
  try {
    return await import("@openai/codex-sdk");
  } catch (error) {
    return {
      loadError: error,
    };
  }
}

export async function runNativeCodexSdkPrompt(options) {
  const promptError = requireNonEmptyString(options?.prompt, "prompt");
  if (promptError) {
    return {
      ok: false,
      error: `native Codex SDK dispatch refused: ${promptError}`,
    };
  }

  if (options.threadId !== undefined && options.threadId !== null) {
    const threadError = requireNonEmptyString(options.threadId, "threadId");
    if (threadError) {
      return {
        ok: false,
        error: `native Codex SDK dispatch refused: ${threadError}`,
      };
    }
  }

  let codex = options.codex ?? null;
  if (!codex) {
    const sdk = await loadCodexSdk();
    if (!sdk.Codex) {
      return {
        ok: false,
        error: "native Codex SDK dispatch refused: @openai/codex-sdk is not installed or does not export Codex",
      };
    }
    codex = new sdk.Codex();
  }
  const thread = options.threadId
    ? codex.resumeThread(options.threadId)
    : codex.startThread();
  const result = await thread.run(options.prompt);
  const normalized = normalizeCodexResult(result);

  return {
    ok: true,
    adapterId: "codex",
    sdkPackage: "@openai/codex-sdk",
    mode: options.threadId ? "resume_thread" : "start_thread",
    threadId: options.threadId ?? thread.id ?? result?.thread_id ?? null,
    finalResponse: normalized.finalResponse,
    result: normalized.raw,
  };
}
