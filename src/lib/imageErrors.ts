/** Preserve useful details when a browser/worker rejects with a non-Error value. */
export const normalizeErrorMessage = (value: unknown): string => {
  if (value instanceof Error) {
    const message = value.message.trim();
    const name = value.name.trim();
    if (message && name && name !== "Error") return `${name}: ${message}`;
    if (message) return message;
    if (name) return name;
  }

  if (typeof value === "string") return value.trim() || "empty error string";
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (typeof value === "object") {
    const record = value as { name?: unknown; message?: unknown };
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (message && name && name !== "Error") return `${name}: ${message}`;
    if (message) return message;
    if (name) return name;

    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Fall through to String() for objects that cannot be serialized.
    }
  }

  const stringified = String(value);
  return stringified === "[object Object]" ? "unknown error object" : stringified;
};
