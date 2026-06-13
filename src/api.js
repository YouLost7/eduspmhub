/** When the server returns HTML (Vite/Connect "Cannot POST…"), show a clear hint. */
export function friendlyNonJsonApiMessage(rawText) {
  const t = String(rawText || "").trimStart();
  if (!t) return "";
  const tl = t.toLowerCase();
  if (tl.includes("payload too large") || tl.includes("request entity too large")) {
    return "The save payload was too large for the server. Shorten lesson text or save in smaller steps.";
  }
  if (t.startsWith("<!") || t.includes("Cannot POST") || t.includes("Error</title>")) {
    if (import.meta.env?.PROD) {
      return (
        "The app could not reach the EduSPM API on this server. In production, deploy with " +
        "Build: npm run build and Start: npm start so Express serves both the React app and /api on the same URL."
      );
    }
    return (
      "The upload did not reach the EduSPM API. From the project folder run npm run dev:all " +
      "(API + Vite together). If you use npm run dev only, set VITE_API_PORT to your API port " +
      "or start the API on port 3001."
    );
  }
  return "";
}

/**
 * Human-readable message for failed fetch responses (JSON or HTML).
 * Call after parsing `raw` into `data` when possible.
 */
export function messageForFailedApiResponse(res, raw, data = {}) {
  const rawStr = String(raw || "");
  let msg =
    (typeof data.error === "string" && data.error) ||
    (typeof data.message === "string" && data.message) ||
    "";

  if (msg && res.status === 404 && /course not found/i.test(msg)) {
    return (
      `${msg} — This usually means the app is talking to a different API than the one that has your courses ` +
      `(for example Vite still proxying to port 3001 while this run’s API is on 3002). Stop every extra ` +
      `\`node server/index.js\` or duplicate \`npm run dev:all\`, restart \`npm run dev:all\` once, and open only the Local URL from that same terminal.`
    );
  }
  if (msg) return msg;

  const hint = friendlyNonJsonApiMessage(rawStr);
  if (hint) return hint;

  if (res.status === 404) {
    return (
      "Not found — the server that received this request does not have that path or resource. " +
      "If you run multiple dev servers, stop the extras and use a single `npm run dev:all` so the Vite URL matches the EduSPM_API_PORT line printed above it."
    );
  }

  const st = String(res.statusText || "").trim();
  if (st) return st;
  if (rawStr) return rawStr.slice(0, 200);
  return "Request failed";
}

export async function apiJson(path, { method = "GET", body, headers = {} } = {}) {
  const init = {
    method,
    credentials: "include",
    headers: { ...headers },
  };
  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    init.headers["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    if (!res.ok) {
      const err = new Error(messageForFailedApiResponse(res, raw, {}));
      err.status = res.status;
      throw err;
    }
    throw new Error("Invalid JSON from server");
  }
  if (!res.ok) {
    const err = new Error(messageForFailedApiResponse(res, raw, data));
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}
