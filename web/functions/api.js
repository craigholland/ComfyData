// ComfyData - API Helpers
//
// Responsibility:
// - Provide safe JSON GET/POST wrappers for ComfyData backend routes.
// - Normalize network/HTTP/JSON errors into a consistent shape.
//
// Contract:
// - Returns: { ok: true, ...data } or { ok: false, error: string }
// - Never throws (call sites can be simple).
//
// Exports:
// - apiGetJson(path)
// - apiPostJson(path, body)

export async function apiGetJson(path) {
  try {
    const res = await fetch(path, { method: "GET" });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      return { ok: false, error: "Invalid JSON response" };
    }

    // If backend already returns { ok: false, error }, preserve it.
    if (data && typeof data === "object" && "ok" in data) return data;

    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function apiPostJson(path, body) {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      return { ok: false, error: "Invalid JSON response" };
    }

    if (data && typeof data === "object" && "ok" in data) return data;

    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
