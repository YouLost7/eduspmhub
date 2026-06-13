# EduSPM Hub

Integrated SPM learning experience for Malaysian students and educators. The **frontend** is React (Vite) with Framer Motion. **Authentication is real**: Express API, bcrypt password hashing, and **cookie sessions** (not localStorage).

## How to run (frontend + API)

```bash
cd /home/roots/eduspmhub1
npm install
cp .env.example .env   # optional — edit Stripe keys etc.
npm run dev:all
```

This starts the **API first** (it picks **3001**, or the next free port if something else is already bound), prints `EduSPM_API_PORT=…`, then starts Vite with that value so `/api` proxies correctly. If you run **`npm run dev`** without the API, set `VITE_API_PORT` to match your API (default `3001`).

Open the **Vite** URL from the terminal (often **http://localhost:5173**; another port if that one is busy). **Do not use the API port** (e.g. 3001) as the app URL — that server only serves `/api/…` and a small info page at `/`. After `dev:all` starts, visiting the API root shows a **link to the real app** when possible.

Then register and use **Browse**, **My courses**, and **Profile** (requires sign-in). The **home dashboard** loads live **recommendations**, **popular courses** (by real enrolments), and **educators** from your database plus curated SPM tutors.

### API highlights

- `GET /api/dashboard/featured` — recommendations (boosts your subject if you are a logged-in student), popular courses sorted by enrolment count, educator strip mixing **verified** registered educators, curated house tutors, and up to two **pending** profiles.
- Auth and admin endpoints have basic IP rate limits (`/api/auth/register`, `/api/auth/login`, `/api/admin/*`) to reduce brute-force and abuse.
- Paid course checkout uses Stripe (`/api/payments/checkout`) while free courses keep instant enrolment.
- **1-on-1 tutoring**: verified educators set hourly rate + weekly availability on Profile; students book inside those windows and pay via Stripe; tutors accept/decline (decline triggers automatic Stripe refund); email notifications and ~24h session reminders (console log in dev, [Resend](https://resend.com) with `RESEND_API_KEY` + `MAIL_FROM` in production).

### Scripts

| Command            | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `npm run dev:all`  | API + Vite (recommended)                  |
| `npm run server`   | API only                                  |
| `npm run dev`      | Vite only (needs API elsewhere)           |
| `npm run lint`     | ESLint checks for frontend/backend scripts |
| `npm run test`     | Unit tests (API helpers + DB bootstrap)   |
| `npm run ci`       | Lint + test + build                       |
| `npm run build`    | Production frontend → `dist/`             |

Optional manual smoke test against a running API:

```bash
node scripts/smoke-api.mjs
```

## User experience

- **Students**: Browse catalogue, enrol (demo), see **My courses**, edit **Profile** (school, form). Must register with a **school email** (same rules as before).
- **Educators**: Same hub routes but **different copy and layout** (darker sidebar strip, “My teaching”, verification badge). **Publishing / Add course** stays **locked** until `verified` is true on the server.
- **Learning hub** (`/platform`) stays a public-style resource page; nav shows login/profile from session.

## Verify an educator (local / ops)

After registration, educators have `verified: false`. To unlock teaching APIs in development:

```bash
curl -s -X POST http://localhost:3001/api/admin/verify-educator \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: dev-admin-change-me" \
  -d '{"email":"educator@example.com"}'
```

Set a production key with env: `ADMIN_KEY=your-secret`.

Other env vars:

- `PORT` — API port (default `3001`)
- `SESSION_SECRET` — session signing secret
- `ADMIN_KEY` — required header for verify endpoint
- `CORS_ORIGINS` — **production-only** comma-separated allowlist (for example `https://app.example.com,https://admin.example.com`)
- `PGHOST` — PostgreSQL host (default `localhost`)
- `PGPORT` — PostgreSQL port (default `5432`)
- `PGDATABASE` — PostgreSQL database name (default `eduspmhub`)
- `PGUSER` — PostgreSQL username (default `postgres`)
- `PGPASSWORD` — PostgreSQL password (default `postgres`)
- `RESEND_API_KEY` — optional; sends real booking/reminder emails
- `MAIL_FROM` — sender for Resend (e.g. `EduSPM Hub <onboarding@yourdomain.com>`)
- `APP_BASE_URL` — frontend base URL for Stripe success/cancel redirects (for example `http://localhost:5173`)
- `STRIPE_SECRET_KEY` — Stripe API secret key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook endpoint signing secret

## Payments (Stripe)

- Free courses (`RM0.00`) stay on direct enrolment and do not open checkout.
- Paid courses require successful Stripe payment before access is granted.
- Webhooks record payment state and grant course entitlement idempotently.
- Student transaction endpoints:
  - `GET /api/payments/transactions`
  - `GET /api/payments/receipt/:id`

Local webhook forwarding example:

```bash
stripe listen --forward-to http://localhost:3001/api/payments/webhook
```

Use Stripe test cards in development (for example `4242 4242 4242 4242`).

## Deploy on Railway

Use **one service** that builds the frontend and runs the Express API together (same origin — required for cookie login).

| Setting | Value |
| -------- | ----- |
| **Build command** | `npm run build` |
| **Start command** | `npm start` |
| **Healthcheck** (optional) | `/api/health` |

Add a **PostgreSQL** plugin in the same Railway project. Railway injects `DATABASE_URL` automatically — the server uses that (with SSL) instead of `PGHOST`/`PGPASSWORD`.

**Required variables** (Railway → Variables):

| Variable | Example |
| -------- | ------- |
| `NODE_ENV` | `production` |
| `APP_BASE_URL` | `https://eduspmhub-production.up.railway.app` (no trailing slash) |
| `CORS_ORIGINS` | `https://eduspmhub-production.up.railway.app,http://localhost:5173` |
| `SESSION_SECRET` | long random string |
| `ADMIN_KEY` | long random string |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

`PORT` is set by Railway automatically. Do **not** use `npm run dev` or `vite preview` in production — they only proxy `/api` to localhost and login will fail with “Request failed”.

## Data persistence

- Primary database is local PostgreSQL (`localhost`) for users, enrolments, educator courses, sessions, and payment tables.
- Legacy JSON files (`users.json`, `enrollments.json`, `educator-courses.json`) are imported automatically on first boot when corresponding tables are empty.

## Backend architecture

- `server/index.js` is now the composition root (middleware, shared helpers, route registration).
- Route modules are split by domain:
  - `server/routes/authAdminRoutes.js`
  - `server/routes/profileRoutes.js`
  - `server/routes/educatorRoutes.js`
  - `server/routes/courseRoutes.js`
- `server/routes/paymentRoutes.js`
- `server/routes/tutoringRoutes.js`
- Persistence is PostgreSQL-backed via `server/sqlite.js` (PostgreSQL adapter) and data adapters in `server/db.js` and `server/educatorCourses.js`.
- Session persistence uses `server/sessionStore.js` (PostgreSQL), replacing in-memory session storage.

## Stack

- React 18, React Router 6, Framer Motion
- Express, express-session, bcryptjs, cors
- Vite dev proxy for `/api`

## Static HTML backup

Earlier static pages live in `archive/static-html/`.
