# Deploying KitchenStock

Two vendors, three pieces:

| Piece | Runs on | Notes |
|---|---|---|
| Web (Next.js) | **Vercel** | its own project, root directory `frontend` |
| API (FastAPI) | **Vercel** | a second project, root directory `backend`, Python serverless |
| Database (PostgreSQL) | **Supabase** | Mumbai (`ap-south-1`) |

The API and the web app are **two separate Vercel projects from the same
repository**, distinguished by their Root Directory setting. Vercel builds a
project from one directory, and these are two different applications that happen
to share a repo.

## Read this before you start

**The API is serverless, so every request may hit a brand-new Python process.**
That is fine, but it forces one choice: the database URL must be Supabase's
**transaction pooler on port 6543**. A normal connection would leak a Postgres
connection per cold start until Supabase refused new ones. `app/database.py`
detects port 6543 and switches off prepared statements and client-side pooling,
which that mode requires.

**Cold starts are real.** An idle function takes a few seconds on the first
request while Python boots and reconnects. Later requests are fast. If you are
demoing, load the page once before the client is watching.

**Why not Cloudflare:** Containers requires the Workers Paid plan, and this
account is on the free plan. The Cloudflare setup is still in the repo
(`backend/wrangler.jsonc`, `backend/worker/`, `.github/workflows/deploy-api.yml`)
and works the moment that plan is upgraded. Its workflow is set to manual-only
so it cannot redden your commits in the meantime.

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

## 2. Vercel — the API

A Vercel project pointed at `backend/`. Vercel sees `backend/api/index.py`,
which exposes the same FastAPI app uvicorn runs locally, and `vercel.json`
sends every path to it.

**2a.** vercel.com → **Add New** → **Project** → import this repository.

**2b.** Set **Root Directory** to `backend`. Vercel will detect Python from
`requirements.txt`.

**2c.** Add these environment variables, all for Production, Preview and
Development:

| Name | Value |
|---|---|
| `DATABASE_URL` | the port-**6543** pooler string from step 1 |
| `JWT_SECRET` | a generated key, see below |
| `CORS_ORIGINS` | `https://example.com` for now — fixed in step 4 |
| `SEED_ON_STARTUP` | `false` |
| `SEED_DEMO_DATA` | `false` |
| `DEBUG` | `false` |
| `APP_ENV` | `production` |

Generate the signing key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

`SEED_ON_STARTUP=false` because the schema already exists. Left on, every cold
start makes an extra round trip to Supabase to confirm what you already know.
`DEBUG=false` also hides `/docs`, `/redoc` and `/openapi.json`.

**2d.** Deploy, then check it:

```bash
curl https://<your-api-project>.vercel.app/api/health
```

You want `"status":"ok"` and `"database":"up"`. First request may take a few
seconds — that is the cold start.

## 3. Vercel — the web app

A **second** Vercel project, from the same repository:

| Setting | Value |
|---|---|
| **Root Directory** | `frontend` ← this one is easy to miss |
| Framework | Next.js (detected) |
| Build / install command | from `frontend/vercel.json` |

Environment variables (Production, Preview and Development):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<your-api-project>.vercel.app/api` |
| `NEXT_PUBLIC_APP_NAME` | `KitchenStock` |
| `NEXT_PUBLIC_SHOW_DEMO_LOGINS` | `true` for now — step 6 |

Note the **`/api` suffix** on the API URL. Without it every call 404s.

> `NEXT_PUBLIC_*` values are compiled into the browser bundle at build time, not
> read at runtime. Changing one in the Vercel dashboard does nothing until you
> redeploy.

## 4. Point CORS back at Vercel

The browser calls the API directly, so the API has to allow the Vercel origin.
With the real domain in hand:

In the **API** project on Vercel, edit `CORS_ORIGINS` to your **web** project's
address, with no trailing slash:

```
https://kitchenstock.vercel.app
```

Then redeploy the API project — **Deployments → ⋯ → Redeploy**. Changing an
environment variable does not restart anything on its own.

Include every origin a browser will actually use. Vercel gives each preview
deployment its own domain, and those are **not** covered by the production one —
add them too if you intend to test previews.

## 4b. Your own address: `kitstock.<your-domain>`

Everything above works on the `*.vercel.app` addresses. To use your own name
instead, for example `kitstock.example.com` for the web app and
`api.kitstock.example.com` for the API (replace `example.com` with your domain):

1. **Web project → Settings → Domains → Add** `kitstock.example.com`.
   **API project → Settings → Domains → Add** `api.kitstock.example.com`.
2. Vercel then shows the DNS record to create at your domain registrar. For a
   subdomain it is a **CNAME** (`kitstock` and `api.kitstock`, both pointing to
   `cname.vercel-dns.com`, or the exact value Vercel displays). HTTPS
   certificates are issued automatically once DNS resolves.
3. **Web project** - set `NEXT_PUBLIC_API_URL` to
   `https://api.kitstock.example.com/api` and **redeploy** (it is baked in at
   build time).
4. **API project** - set `CORS_ORIGINS` to `https://kitstock.example.com`
   (keep the `*.vercel.app` address too if you still use it, comma separated)
   and **redeploy**.
5. Open `https://kitstock.example.com` and sign in. A CORS error in the console
   means step 4 was not redeployed.

**One address for both (simplest).** Instead of a second domain, let the web
project forward `/api` to the API project, so the browser only ever uses
`kitstock.example.com` (sign-in is `kitstock.example.com/login`, its request goes
to `kitstock.example.com/api/auth/login`, and there is no CORS to configure):

- **Web project** - set `NEXT_PUBLIC_API_URL` to `/api` and
  `API_PROXY_TARGET` to `https://<your-api-project>.vercel.app`, then redeploy.
- **API project** - nothing to add; same-origin calls do not need CORS.

Skip the API subdomain if you like: the web app can sit on its own name while
`NEXT_PUBLIC_API_URL` keeps pointing at the API project's `*.vercel.app`
address.

On your own computer the matching name is `http://kitstock.localhost:3000`
(API at `http://api.kitstock.localhost:8000/api`); see `frontend/.env.example`.

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
- [ ] `SEED_DEMO_DATA` and `SEED_ON_STARTUP` are already `false` on the API
      project, so nothing can refill the database with demo cakes.
- [ ] Delete the demo kitchens, items and recipes, or start from a fresh
      Supabase project with `SEED_DEMO_DATA=false` from the first boot.
- [ ] Turn on Point-in-Time Recovery in Supabase if this becomes the only record
      of the client's stock.

## When something breaks

| What you see | Cause |
|---|---|
| `Failed to fetch` / CORS error in the console | The web project's address is not in the API project's `CORS_ORIGINS`, or you set it and did not redeploy the API |
| Every API call 404s | `NEXT_PUBLIC_API_URL` is missing the `/api` suffix |
| API calls go to `localhost:8000` | `NEXT_PUBLIC_API_URL` was not set at **build** time — set it and redeploy the web project |
| API 500s on every request | Wrong `DATABASE_URL`. It must be the port-**6543** pooler host, and the `@` in the password must be written `%40` |
| `prepared statement … already exists` | A pooler URL the app did not recognise as one. The port must be `6543` |
| `too many connections` / `remaining connection slots reserved` | A non-pooler URL on serverless: each cold start opened its own connection. Use port 6543 |
| `connection refused` / `network unreachable` | The direct `db.<ref>.supabase.co` host, which is IPv6-only. Use the pooler |
| First request slow, the rest fast | Cold start. Normal for serverless — load the page once before demoing |
| `ModuleNotFoundError: app` at build | `includeFiles` in `backend/vercel.json` is what bundles the `app/` package — do not remove it |
| Both Vercel projects build the same thing | One of them has the wrong **Root Directory**. API is `backend`, web is `frontend` |
