# EduSPM Hub

Integrated SPM learning experience for Malaysian students and educators. The **frontend** is React (Vite) with Framer Motion. **Authentication is real**: Express API, bcrypt password hashing, and **cookie sessions** (not localStorage).

## How to run (frontend + API)

```bash
cd /home/roots/eduspmhub1
npm install
npm run dev:all
```

This starts the **API first** (it picks **3001**, or the next free port if something else is already bound), prints `EduSPM_API_PORT=…`, then starts Vite with that value so `/api` proxies correctly. If you run **`npm run dev`** without the API, set `VITE_API_PORT` to match your API (default `3001`).

Open the **Vite** URL from the terminal (often **http://localhost:5173**; another port if that one is busy). **Do not use the API port** (e.g. 3001) as the app URL — that server only serves `/api/…` and a small info page at `/`. After `dev:all` starts, visiting the API root shows a **link to the real app** when possible.

Then register and use **Browse**, **My courses**, and **Profile** (requires sign-in). The **home dashboard** loads live **recommendations**, **popular courses** (by real enrolments), and **educators** from your database plus curated SPM tutors.

### API highlights

- `GET /api/dashboard/featured` — recommendations (boosts your subject if you are a logged-in student), popular courses sorted by enrolment count, educator strip mixing **verified** registered educators, curated house tutors, and up to two **pending** profiles.

### Scripts

| Command        | Purpose                          |
| -------------- | -------------------------------- |
| `npm run dev:all` | API + Vite (recommended)      |
| `npm run server`  | API only                        |
| `npm run dev`     | Vite only (needs API elsewhere) |
| `npm run build`   | Production frontend → `dist/`   |

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

## Data files (gitignored)

- `server/data/users.json` — user accounts (hashed passwords)
- `server/data/enrollments.json` — per-user course IDs

## Stack

- React 18, React Router 6, Framer Motion
- Express, express-session, bcryptjs, cors
- Vite dev proxy for `/api`

## Static HTML backup

Earlier static pages live in `archive/static-html/`.
