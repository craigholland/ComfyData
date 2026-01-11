// ComfyData – API Helpers
//
// Purpose:
// - Provide small, consistent wrappers around fetch() for the ComfyData backend.
// - Normalize error handling into a single { ok, error, ... } shape.
//
// Design:
// - We always attempt to parse JSON if possible.
// - Network/HTTP/JSON errors become: { ok: false, error: <string> }
// - Successful responses return the parsed JSON (unchanged) if it already has
//   an ok flag, otherwise we wrap: { ok: true, data: <json> }

async function parseJsonSafely(res) {
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

function normalizeError(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err?.message) return String(err.message);
  try {
    return JSON.stringify(err);
  } catch (_) {
    return String(err);
  }
}

export async function safeGetJson(path) {
  try {
    const res = await fetch(path, { method: "GET" });
    const body = await parseJsonSafely(res);

    if (!res.ok) {
      return { ok: false, error: body?.error || body?.message || `${res.status} ${res.statusText}` };
    }

    // backend convention: { ok: true, ... }
    if (body && typeof body === "object" && "ok" in body) return body;

    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, error: normalizeError(err) };
  }
}

export async function safePostJson(path, payload) {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    const body = await parseJsonSafely(res);

    if (!res.ok) {
      return { ok: false, error: body?.error || body?.message || `${res.status} ${res.statusText}` };
    }

    if (body && typeof body === "object" && "ok" in body) return body;

    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, error: normalizeError(err) };
  }
}
