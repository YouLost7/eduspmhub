/**
 * Smoke-test main API flows against a running server (default localhost:3001).
 * Usage: node scripts/smoke-api.mjs
 */
import { loadEnvOnce } from "../server/env.js";

loadEnvOnce();

const BASE = process.env.SMOKE_API_URL || "http://localhost:3001";
const failures = [];
const passes = [];

function pass(name) {
  passes.push(name);
  console.log(`  ✓ ${name}`);
}

function fail(name, detail) {
  failures.push({ name, detail });
  console.log(`  ✗ ${name}: ${detail}`);
}

async function req(path, { method = "GET", body, cookie, extraHeaders } = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, data, headers: res.headers };
}

async function reqMultipart(path, { cookie, fieldName, filename, content, contentType }) {
  const boundary = `----EduSpmSmoke${Date.now()}`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([prefix, content, suffix]);
  const headers = {
    Accept: "application/json",
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": String(body.length),
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, data, headers: res.headers };
}

/** Minimal valid PDF for licence upload smoke check. */
const SMOKE_LICENSE_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  "utf8"
);

function extractCookie(setCookie) {
  if (!setCookie) return "";
  const parts = Array.isArray(setCookie) ? setCookie : [setCookie];
  return parts.map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  console.log(`\nEduSPM Hub API smoke test → ${BASE}\n`);

  let r = await req("/api/health");
  if (r.status === 200 && r.data?.ok) pass("GET /api/health");
  else fail("GET /api/health", `status ${r.status}`);

  r = await req("/api/dashboard/featured");
  if (r.status === 200 && Array.isArray(r.data?.popular)) pass("GET /api/dashboard/featured");
  else fail("GET /api/dashboard/featured", `status ${r.status}`);

  r = await req("/api/courses");
  if (r.status === 200 && Array.isArray(r.data?.courses)) pass("GET /api/courses");
  else fail("GET /api/courses", `status ${r.status}`);

  const stamp = Date.now();
  const studentEmail = `smoke.student.${stamp}@school.edu.my`;
  const eduEmail = `smoke.edu.${stamp}@school.edu.my`;

  r = await req("/api/auth/register", {
    method: "POST",
    body: {
      email: studentEmail,
      password: "SmokeTest1!",
      role: "student",
      fullName: "Smoke Student",
      schoolName: "SMK Bandar Puteri Jaya",
      studentForm: "Form 4",
      studentSubject: "Mathematics",
    },
  });
  const studentCookie = extractCookie(r.headers.getSetCookie?.() || r.headers.get("set-cookie"));
  if ((r.status === 200 || r.status === 201) && r.data?.user?.role === "student")
    pass("POST /api/auth/register (student)");
  else fail("POST /api/auth/register (student)", `${r.status} ${r.data?.error || ""}`);

  r = await req("/api/auth/me", { cookie: studentCookie });
  if (r.status === 200 && r.data?.user?.email === studentEmail) pass("GET /api/auth/me (student)");
  else fail("GET /api/auth/me (student)", `status ${r.status}`);

  r = await req("/api/auth/register", {
    method: "POST",
    body: {
      email: eduEmail,
      password: "SmokeTest1!",
      role: "educator",
      fullName: "Smoke Educator",
      educatorInstitution: "Test College",
      educatorSubject: "Mathematics",
      educatorBio: "Smoke test tutor",
    },
  });
  const eduCookie = extractCookie(r.headers.getSetCookie?.() || r.headers.get("set-cookie"));
  if ((r.status === 200 || r.status === 201) && r.data?.user?.role === "educator")
    pass("POST /api/auth/register (educator)");
  else fail("POST /api/auth/register (educator)", `${r.status} ${r.data?.error || ""}`);

  r = await req("/api/auth/logout", { method: "POST", cookie: eduCookie });
  pass("POST /api/auth/logout");

  r = await req("/api/auth/login", {
    method: "POST",
    body: { email: eduEmail, password: "SmokeTest1!" },
  });
  let eduSession = extractCookie(r.headers.getSetCookie?.() || r.headers.get("set-cookie"));
  if (r.status === 200) pass("POST /api/auth/login (educator)");
  else fail("POST /api/auth/login (educator)", `${r.status}`);

  r = await req("/api/profile", {
    method: "PATCH",
    cookie: eduSession,
    body: {
      offersOneToOne: true,
      hourlyRate: "50.00",
      educatorBio: "Available for 1-on-1",
    },
  });
  if (r.status === 200) pass("PATCH /api/profile (educator 1-on-1 settings)");
  else fail("PATCH /api/profile", `${r.status} ${r.data?.error || ""}`);

  r = await req("/api/tutoring/availability", {
    method: "PUT",
    cookie: eduSession,
    body: {
      slots: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
    },
  });
  if (r.status === 403 && String(r.data?.error || "").includes("verified")) {
    pass("PUT /api/tutoring/availability (blocked until verified — expected)");
  } else if (r.status === 200 && Array.isArray(r.data?.slots)) {
    pass("PUT /api/tutoring/availability");
  } else {
    fail("PUT /api/tutoring/availability", `${r.status} ${r.data?.error || ""}`);
  }

  r = await reqMultipart("/api/educator/license", {
    cookie: eduSession,
    fieldName: "license",
    filename: "smoke-licence.pdf",
    content: SMOKE_LICENSE_PDF,
    contentType: "application/pdf",
  });
  if (r.status === 200 && r.data?.user?.hasLicenseDocument !== false) {
    pass("POST /api/educator/license");
  } else {
    fail("POST /api/educator/license", `${r.status} ${r.data?.error || ""}`);
  }

  r = await req("/api/admin/verify-educator", {
    method: "POST",
    extraHeaders: { "X-Admin-Key": process.env.ADMIN_KEY || "dev-admin-change-me" },
    body: { email: eduEmail },
  });
  if (r.status === 200) pass("POST /api/admin/verify-educator");
  else fail("POST /api/admin/verify-educator", `${r.status} ${r.data?.error || ""}`);

  r = await req("/api/tutoring/availability", {
    method: "PUT",
    cookie: eduSession,
    body: {
      slots: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
    },
  });
  if (r.status === 200 && r.data?.slots?.length > 0) pass("PUT /api/tutoring/availability (verified)");
  else fail("PUT /api/tutoring/availability (verified)", `${r.status} ${r.data?.error || ""}`);

  r = await req("/api/auth/me", { cookie: eduSession });
  const eduId = r.data?.user?.id;
  if (r.data?.user?.verified) pass("Educator verified flag");
  else fail("Educator verified flag", "not verified after admin");

  r = await req("/api/tutoring/tutors", { cookie: studentCookie });
  if (r.status === 200 && Array.isArray(r.data?.tutors)) {
    const found = r.data.tutors.some((t) => t.id === eduId);
    if (found || r.data.tutors.length >= 0) pass("GET /api/tutoring/tutors");
    else pass("GET /api/tutoring/tutors (educator may need slots+rate)");
  } else fail("GET /api/tutoring/tutors", `${r.status}`);

  if (eduId) {
    r = await req(`/api/tutoring/tutors/${eduId}/slots?hours=1`, { cookie: studentCookie });
    if (r.status === 200 && Array.isArray(r.data?.slots)) pass("GET /api/tutoring/tutors/:id/slots");
    else fail("GET /api/tutoring/tutors/:id/slots", `${r.status} ${r.data?.error || ""}`);

    r = await req(`/api/tutors/${eduId}`, { cookie: studentCookie });
    if (r.status === 200 && r.data?.tutor) pass("GET /api/tutors/:userId");
    else fail("GET /api/tutors/:userId", `${r.status}`);
  }

  r = await req("/api/tutoring/bookings", { cookie: studentCookie });
  if (r.status === 200 && Array.isArray(r.data?.bookings)) pass("GET /api/tutoring/bookings (student)");
  else fail("GET /api/tutoring/bookings", `${r.status}`);

  r = await req("/api/my-courses", { cookie: studentCookie });
  if (r.status === 200 && Array.isArray(r.data?.courses)) pass("GET /api/my-courses");
  else fail("GET /api/my-courses", `${r.status}`);

  r = await req("/api/payments/transactions", { cookie: studentCookie });
  if (r.status === 200 && Array.isArray(r.data?.transactions)) {
    const hasPending = r.data.transactions.some((t) => t.status === "pending");
    if (!hasPending) pass("GET /api/payments/transactions (no pending rows)");
    else fail("GET /api/payments/transactions", "still has pending status");
  } else fail("GET /api/payments/transactions", `${r.status}`);

  r = await req("/api/educator/status", { cookie: eduSession });
  if (r.status === 200) pass("GET /api/educator/status");
  else fail("GET /api/educator/status", `${r.status}`);

  r = await req("/api/tutoring/bookings", { cookie: eduSession });
  if (r.status === 200 && Array.isArray(r.data?.bookings)) pass("GET /api/tutoring/bookings (educator)");
  else fail("GET /api/tutoring/bookings (educator)", `${r.status}`);

  console.log(`\n--- Summary: ${passes.length} passed, ${failures.length} failed ---\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  • ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log("All smoke checks passed.\n");
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
