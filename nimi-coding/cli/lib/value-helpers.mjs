export function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isIsoUtcTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false;
  }

  const parsed = new Date(value);
  const canonicalValue = value.includes(".") ? value : value.replace("Z", ".000Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === canonicalValue;
}

export function toStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry));
}
