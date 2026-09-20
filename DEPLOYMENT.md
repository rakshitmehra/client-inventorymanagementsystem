# Deploying KitchenStock

Three services, three vendors:

| Piece | Runs on | Why there |
|---|---|---|
| Web (Next.js) | **Vercel** | Next.js's own host; static pages go to the CDN |
| API (FastAPI) | **Cloudflare Containers** | Runs the ordinary Docker image — see the note below |
| Database (PostgreSQL) | **Supabase** | Managed Postgres with connection pooling |

## Read this before you start

**Cloudflare *Workers* cannot run this API.** Python Workers execute in Pyodide
(WebAssembly), which cannot load `psycopg` — it is a C extension around libpq —
and a Worker cannot open a raw TCP socket to PostgreSQL from Python. Cloudflare
**Containers** runs the real Docker image, so that is what `backend/` is set up
for: `wrangler.jsonc` and a one-file Worker sitting beside the Dockerfile they
deploy, the same way `frontend/vercel.json` sits beside the app it deploys.

If Containers turns out not to suit you, nothing about the app is Cloudflare-
specific. `backend/Dockerfile` runs unchanged on Render, Railway, Fly.io or any
host that takes a container, and only step 2 below changes.

**The demo sign-in buttons are on in production by default**, so you can test
the moment it is live. Step 6 covers turning them off.

---

## 1. Supabase — the database

1. Create a project. Save the database password Supabase shows you once.
2. **Project Settings → Database → Connection string → Session pooler.**
   Copy it. It looks like:

   ```
   postgresql://postgres.abcdefghijklm:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
   ```

3. Change the scheme to `postgresql+psycopg://` and append `?sslmode=require`:

   ```
   postgresql+psycopg://postgres.abcdefghijklm:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
   ```

Which of Supabase's three hostnames you pick matters:

| Connection | Port | Use it when | Watch out |
|---|---|---|---|
| **Session pooler** | 5432 | **This deployment.** A long-running container. | — |
| Transaction pooler | 6543 | Serverless, a fresh process per request | The app detects port 6543 and turns off prepared statements and its own pool, which that mode requires |
| Direct | 5432 | You know you have IPv6 end to end | `db.<ref>.supabase.co` is **IPv6-only**; it simply fails to connect from IPv4-only hosts |

You do **not** need to create any tables. The API creates its schema on first
boot and loads the demo dataset into an empty database.

## 2. Cloudflare — the API

```bash
cd backend
bun install            # installs wrangler + the container SDK, not the API
bunx wrangler login
```

> `backend/` holds two toolchains: Python for the API itself
> (`requirements.txt`) and a little Node for the deploy tooling
> (`package.json`). The Worker runs on Cloudflare's edge, not inside the
> container, and `.dockerignore` keeps `node_modules/` out of the image.

Set the three secrets. They are never written to a file:

```bash
bunx wrangler secret put DATABASE_URL     # the string from step 1
bunx wrangler secret put JWT_SECRET       # see below
bunx wrangler secret put CORS_ORIGINS     # set after step 3; use a placeholder for now
```

Generate a real signing key — do not ship the default:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Deploy:

```bash
bunx wrangler deploy
```

Wrangler builds `backend/Dockerfile`, pushes it, and prints a
`https://kitchenstock-api.<your-subdomain>.workers.dev` URL. Check it:

```bash
curl https://kitchenstock-api.<your-subdomain>.workers.dev/api/health
```

The first request is slow — it starts the container, creates the schema and
seeds the demo data. Later requests are fast until it idles for 15 minutes.

## 3. Vercel — the web app

Import the repository, then:

| Setting | Value |
|---|---|
| **Root Directory** | `frontend` ← this one is easy to miss |
| Framework | Next.js (detected) |
| Build / install command | from `frontend/vercel.json` |

Environment variables (Production, Preview and Development):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://kitchenstock-api.<your-subdomain>.workers.dev/api` |
| `NEXT_PUBLIC_APP_NAME` | `KitchenStock` |
| `NEXT_PUBLIC_SHOW_DEMO_LOGINS` | `true` for now — step 6 |

Note the **`/api` suffix** on the API URL. Without it every call 404s.

> `NEXT_PUBLIC_*` values are compiled into the browser bundle at build time, not
> read at runtime. Changing one in the Vercel dashboard does nothing until you
> redeploy.

## 4. Point CORS back at Vercel

The browser calls the API directly, so the API has to allow the Vercel origin.
With the real domain in hand:

```bash
cd backend
bunx wrangler secret put CORS_ORIGINS
# https://kitchenstock.vercel.app
bunx wrangler deploy
```

Include every origin a browser will actually use. Vercel gives each preview
deployment its own domain, and those are **not** covered by the production one —
add them too if you intend to test previews.

## 5. Check it

Open the Vercel URL and work down this list. It covers every layer: CDN, API,
database, auth and role scoping.

- [ ] The login page renders, with the demo buttons under the form
- [ ] Tap **Administrator** → **Sign in**. A failure here is almost always CORS
      (step 4) or a missing `/api` suffix (step 3) — open the browser console,
      it will say which
- [ ] The dashboard shows stock values, not zeroes → the database seeded
- [ ] **Main Store** lists 18 ingredients
- [ ] **Send to a Kitchen**: move something and confirm. The transfer detail
      page appears with a new TRF number → writes and transactions work
- [ ] **Print slip** renders the document
- [ ] Sign out, sign in as `rajesh.kumar`. The sidebar is shorter, and typing
      `/users` in the address bar bounces you to the dashboard → role scoping
      survived deployment
- [ ] Open the site on a phone — the menu becomes a drawer and tables become
      cards

## 6. Before it holds anyone's real stock

- [ ] Set `NEXT_PUBLIC_SHOW_DEMO_LOGINS=false` in Vercel and redeploy. Until you
      do, four working passwords are printed on a public page.
- [ ] Change the `admin` password from `Admin@123`, and every manager password
      from `Manager@123`. Sign in as admin → **People** → **Reset password**.
- [ ] Confirm `JWT_SECRET` is the generated value, not `change-me-in-production`.
- [ ] Set `SEED_DEMO_DATA=false` in `backend/worker/index.ts` and
      redeploy, once the client has entered their own items. It only fires on a
      database with no items, so it cannot overwrite live stock — this is to
      stop an empty-database accident refilling the system with demo cakes.
- [ ] Delete the demo kitchens, items and recipes, or start from a fresh
      Supabase project with `SEED_DEMO_DATA=false` from the first boot.
- [ ] Turn on Point-in-Time Recovery in Supabase if this becomes the only record
      of the client's stock.

## When something breaks

| What you see | Cause |
|---|---|
| `Failed to fetch` / CORS error in the console | The Vercel origin is not in `CORS_ORIGINS` (step 4), or you changed it without redeploying the Worker |
| Every API call 404s | `NEXT_PUBLIC_API_URL` is missing the `/api` suffix |
| API calls go to `localhost:8000` | `NEXT_PUBLIC_API_URL` was not set at **build** time — set it and redeploy |
| First request times out, later ones work | Container cold start. Normal after 15 minutes idle |
| `connection refused` / `network unreachable` from the API | You used the direct `db.<ref>.supabase.co` host, which is IPv6-only. Use the session pooler |
| `prepared statement "__asyncpg_1__" already exists` | A transaction-pooler URL that the app did not detect. Confirm the port is `6543` or add `?pgbouncer=true` |
| `too many connections` | `max_instances` x `DB_POOL_SIZE` exceeds the Supabase limit. Lower one of them |
| `remaining connection slots reserved` | Same, and Supabase's free tier is small — start at 2 instances x pool of 5 |
