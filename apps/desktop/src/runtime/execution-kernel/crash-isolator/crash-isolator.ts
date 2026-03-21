type CrashEntry = {
  count: number;
  firstAt: string;
  lastAt: string;
  disabled: boolean;
};

const DEFAULT_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 60_000;

export class CrashIsolator {
  private readonly entries = new Map<string, CrashEntry>();
  private readonly threshold: number;
  private readonly cooldownMs: number;

  constructor(options?: { threshold?: number; cooldownMs?: number }) {
    this.threshold = options?.threshold ?? DEFAULT_THRESHOLD;
    this.cooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  private isCooldownExpired(entry: CrashEntry): boolean {
    return Date.now() - new Date(entry.lastAt).getTime() >= this.cooldownMs;
  }

  private isEntryDisabled(entry: CrashEntry): boolean {
    return entry.disabled && !this.isCooldownExpired(entry);
  }

  report(modId: string): number {
    const now = new Date().toISOString();
    const existing = this.entries.get(modId);
    if (existing) {
      if (this.isCooldownExpired(existing)) {
        existing.count = 0;
        existing.disabled = false;
        existing.firstAt = now;
      }
      existing.count += 1;
      existing.lastAt = now;
      if (existing.count >= this.threshold) {
        existing.disabled = true;
      }
      return existing.count;
    }
    const entry: CrashEntry = {
      count: 1,
      firstAt: now,
      lastAt: now,
      disabled: 1 >= this.threshold,
    };
    this.entries.set(modId, entry);
    return 1;
  }

  shouldDisable(modId: string): boolean {
    const entry = this.entries.get(modId);
    if (!entry) {
      return false;
    }
    return this.isEntryDisabled(entry);
  }

  reset(modId: string): void {
    this.entries.delete(modId);
  }

  resetAll(): void {
    this.entries.clear();
  }

  getStatus(modId: string): {
    crashCount: number;
    disabled: boolean;
    lastCrashAt: string | null;
  } {
    const entry = this.entries.get(modId);
    if (!entry) {
      return { crashCount: 0, disabled: false, lastCrashAt: null };
    }
    return {
      crashCount: entry.count,
      disabled: this.isEntryDisabled(entry),
      lastCrashAt: entry.lastAt,
    };
  }

  listDisabled(): string[] {
    const result: string[] = [];
    for (const [modId, entry] of this.entries) {
      if (this.isEntryDisabled(entry)) {
        result.push(modId);
      }
    }
    return result;
  }
}
