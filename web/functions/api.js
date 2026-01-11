
async function apiGetJson(path) {
  try {
    const res = await fetch(path, { method: "GET" });

    // Prefer explicit message if server returns non-OK
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch (_) {}
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}` };
    }

    const data = await res.json();
    if (data && typeof data === "object") return data;
    return { ok: false, error: "Invalid JSON response." };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function apiPostJson(path, body) {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch (_) {}
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}` };
    }

    const data = await res.json();
    if (data && typeof data === "object") return data;
    return { ok: false, error: "Invalid JSON response." };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
