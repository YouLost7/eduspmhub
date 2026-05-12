/**
 * Starts the API first, reads EduSPM_API_PORT from stdout, then starts Vite with
 * VITE_API_PORT so /api proxies to the correct port (handles EADDRINUSE on 3001).
 * Writes `.frontend-dev-url` when Vite prints its Local URL so the API root page can link to the app.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const serverEntry = path.join(root, "server", "index.js");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const frontendHintPath = path.join(root, ".frontend-dev-url");

const API_READY = /^EduSPM_API_PORT=(\d+)$/;
const START_TIMEOUT_MS = 25_000;

function clearFrontendHint() {
  try {
    if (existsSync(frontendHintPath)) unlinkSync(frontendHintPath);
  } catch {
    /* ignore */
  }
}

clearFrontendHint();

const server = spawn(process.execPath, [serverEntry], {
  cwd: root,
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});

let buf = "";
let viteProc = null;
let viteBuf = "";
let viteUrlWritten = false;
let apiPort = null;

const startTimeout = setTimeout(() => {
  if (apiPort == null) {
    console.error(
      "\nTimed out waiting for API to listen. Check server/index.js and server logs above.\n"
    );
    clearFrontendHint();
    server.kill("SIGTERM");
    process.exit(1);
  }
}, START_TIMEOUT_MS);

function startVite() {
  if (viteProc) return;
  clearTimeout(startTimeout);
  viteProc = spawn(process.execPath, [viteBin], {
    cwd: root,
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env, VITE_API_PORT: String(apiPort) },
  });
  viteProc.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    if (viteUrlWritten) return;
    viteBuf += chunk.toString("utf8");
    for (;;) {
      const nl = viteBuf.indexOf("\n");
      if (nl === -1) break;
      const line = viteBuf.slice(0, nl).replace(/\r$/, "");
      viteBuf = viteBuf.slice(nl + 1);
      const m = line.match(/Local:\s+(https?:\/\/[^\s]+)/);
      if (m) {
        const u = m[1].replace(/\/$/, "");
        try {
          writeFileSync(frontendHintPath, `${u}\n`, "utf8");
          viteUrlWritten = true;
        } catch (e) {
          console.error("Could not write .frontend-dev-url:", e.message);
        }
        break;
      }
    }
  });
  viteProc.on("exit", (code, signal) => {
    clearFrontendHint();
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

function drainStdout(chunk) {
  process.stdout.write(chunk);
  buf += chunk.toString("utf8");
  for (;;) {
    const nl = buf.indexOf("\n");
    if (nl === -1) break;
    const line = buf.slice(0, nl).replace(/\r$/, "");
    buf = buf.slice(nl + 1);
    const m = line.match(API_READY);
    if (m) {
      apiPort = parseInt(m[1], 10);
      if (apiPort !== 3001) {
        console.warn(
          "\nEduSPM: API bound to port " +
            apiPort +
            " because the default port (3001) or the next free port was already in use.\n" +
            "If another terminal still runs an OLD API on 3001, a different Vite tab (wrong port) may proxy /api there and show removed dummy courses.\n" +
            "Stop extra `npm run dev:all` / `node server/index.js` processes, then restart — and use only the Vite Local URL printed for this run.\n"
        );
      }
      startVite();
      break;
    }
  }
}

server.stdout.on("data", drainStdout);
server.stderr.on("data", (c) => process.stderr.write(c));

server.on("exit", (code, signal) => {
  clearTimeout(startTimeout);
  if (viteProc && !viteProc.killed) {
    viteProc.kill(signal || "SIGTERM");
  }
  if (!viteProc && (code ?? 0) !== 0) {
    clearFrontendHint();
    process.exit(code ?? 1);
  }
});

function shutdown() {
  clearFrontendHint();
  if (viteProc && !viteProc.killed) viteProc.kill("SIGTERM");
  if (!server.killed) server.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
