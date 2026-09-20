# KitchenStock — Multi-Kitchen Inventory Management

Inventory management for a business that runs one central **Main Inventory** and
several independent **Kitchen Sub-Inventories**. The administrator owns the main
store and every kitchen; each kitchen manager sees only the kitchen they are
assigned to.

Two independent services:

| Service | Stack | Port | Directory |
|---|---|---|---|
| API | FastAPI · SQLAlchemy 2 · PostgreSQL | 8000 | [`backend/`](backend) |
| Web | Next.js 14 (App Router) · React 18 · Bun | 3000 | [`frontend/`](frontend) |

They share nothing but HTTP: the frontend talks to the API over
`NEXT_PUBLIC_API_URL`, and the API owns the database.

**Deploying?** See [DEPLOYMENT.md](DEPLOYMENT.md) — Vercel for the web app,
Cloudflare Containers for the API, Supabase for the database.

---

## Quick start

### With Docker (everything, including the database)

```bash
docker compose up --build
```

Then open <http://localhost:3000> and sign in with one of the demo accounts
below.

### Without Docker

Requires Python 3.11+, PostgreSQL 14+, and [Bun](https://bun.sh) 1.1+ (or Node
18+ with npm — see the note under step 3).

**1. Create the database:**

```bash
createdb kitchenstock
```

Any PostgreSQL will do — a local install, a Docker container, or a Supabase
project. The API creates its own tables on first boot; you only need an empty
database to point it at.

**2. Start the API:**

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

On an empty database the service creates the schema and loads the demo dataset
automatically. Interactive API docs: <http://localhost:8000/docs>.

**3. Start the frontend:**

```bash
cd frontend
bun install
cp .env.example .env.local
bun run dev
```

The frontend uses [Bun](https://bun.sh) as its package manager and script
runner — it installs the dependency tree several times faster than npm and the
`bun.lock` file is committed so every machine resolves the same versions. Next.js
itself still runs on Node under the hood, so nothing about the application code
changes. If Bun is not installed, `npm install` / `npm run dev` work exactly the
same way; only the lockfile differs. Bun is a frontend-only choice: the backend
is Python and keeps pip + `requirements.txt`.

---

## Demo accounts

| Role | Username | Password | Sees |
|---|---|---|---|
| Administrator | `admin` | `Admin@123` | Everything |
| Kitchen Manager | `rajesh.kumar` | `Manager@123` | Central Production Kitchen |
| Kitchen Manager | `meera.nair` | `Manager@123` | Koregaon Park Outlet Kitchen |
| Kitchen Manager | `arjun.deshpande` | `Manager@123` | Hinjewadi Cloud Kitchen |

The demo data includes 18 raw materials, 3 kitchens, 4 products with costed
recipes, goods receipts, transfers, production runs, wastage and adjustments —
roughly 200 ledger entries spread over the last four weeks.

---

## What the system does

### Roles

* **Administrator** — creates and deactivates kitchens, assigns managers,
  manages the catalogue, receives stock into the Main Inventory, transfers it to
  any kitchen, and sees every kitchen's stock, movements, production, wastage,
  reports and the audit log.
* **Kitchen Manager** — sees only their assigned kitchens. They record
  production, wastage and stock counts for those kitchens and can print the
  matching slips. They cannot reach the Main Inventory, other kitchens, user
  administration or the audit log.

Access is enforced on the server (`assert_kitchen_access`, `require_admin`), not
just hidden in the UI.

### The stock engine

Every change to any balance — main or kitchen — goes through one function,
`services/inventory.apply_movement()`. It is the only code that writes to
`main_inventory` or `kitchen_inventory`, and it always writes a matching
`stock_movements` row in the same transaction.

* Balance rows are read `FOR UPDATE`, so two kitchens drawing on the same Main
  Inventory line serialise instead of both reading a stale quantity.
* CockroachDB runs `SERIALIZABLE`; a conflicting transaction surfaces as a
  `40001` retry error, which `run_in_transaction()` replays with backoff.
* Multi-line documents check **every** line before moving anything, so a
  partly-filled transfer is never written — the caller gets one complete list of
  what is short.
* `CHECK (quantity >= 0)` on both stock tables means the database itself refuses
  to go negative even if the service layer is bypassed.

### Transfers

The admin moves stock from the Main Inventory to a kitchen (or back). Each item
writes **two** ledger rows: one `TRANSFER_OUT` from the source and one
`TRANSFER_IN` into the destination, both carrying the balance before and after,
the document number, and the user who performed it.

### Recipes and production

A product (say a cake) has a versioned recipe listing every ingredient and
quantity. A manager selects the product, enters how many units they are making,
and the system:

1. scales the recipe to the requested output,
2. checks each ingredient against that kitchen's stock,
3. shows what is required, what is available and what would be left,
4. on confirmation, deducts every ingredient and writes **one consumption record
   per ingredient** — the finished product is never recorded as a single opaque
   line.

Editing a recipe creates a new version and supersedes the old one, so past
production still shows what was actually used.

### Units

Units are grouped by dimension (mass / volume / count) with a factor to that
dimension's base unit. That is what lets a recipe say "500 g of flour" while the
warehouse stocks flour in kg. Converting across dimensions (kg → litres) is
rejected.

### Printable slips

Every transaction produces a printable document for the kitchen involved —
transfer slip, production slip, goods receipt note, wastage note, adjustment
note. Each carries the company header, kitchen name and manager, document number,
date and time, line items with quantities and units, source and destination, and
signature blocks. Reprints are logged.

### Reports

Low stock (main and per kitchen), kitchen stock, item consumption, production,
transfers, wastage, adjustments, stock valuation, and a complete item-wise
movement history. Kitchen managers see the same reports scoped to their kitchen.

### The interface

The people using this are kitchen staff, not warehouse clerks, so the interface
is built for reading at arm's length:

- 16px base text, a 28px page heading, and a 48px minimum tap target - a step
  above ordinary web sizing, without reading as a large-print edition
- body text at a 7:1 contrast ratio, well past the 4.5:1 minimum
- one icon set, drawn as inline SVG on a single 24px grid at one stroke weight,
  taking its colour from the text around it. No emoji anywhere: emoji are drawn
  by the operating system, so they arrive at a different weight, colour and size
  on every device, and they read as informal
- plain-English navigation grouped as *Everyday jobs*, *Look things up* and
  *Set-up* - "Send to a Kitchen", not "Outbound Transfers"
- the two long jobs (sending stock, recording cooking) are numbered steps down
  a single column, with nothing committed until the final confirm screen
- one search box on every list; the rest of the filters sit behind *More
  filters* so the data is the first thing on screen
- nothing asks a question that has only one answer: a manager who runs one
  kitchen is told which kitchen, not asked to pick it from a list of one

It is responsive rather than a separate mobile build:

| Width | Layout |
|---|---|
| Over 1024px | Sidebar pinned open, full tables, header pinned |
| 761-1024px | Sidebar becomes a drawer behind a menu button; page buttons move to their own full-width row |
| Up to 900px | Every table row becomes a card, each value labelled with its column heading - no sideways scrolling |
| Up to 760px | Single-column grids and forms, full-screen dialogs, header scrolls away to leave the screen to the list |

Printable slips keep their real table at every width, because a slip has to look
like the paper it is about to become.

---

## Project layout

```
backend/
  app/
    main.py            FastAPI app, CORS, error handlers, router wiring
    config.py          environment-driven settings
    database.py        engine, session, SERIALIZABLE retry wrapper
    models.py          SQLAlchemy models (26 tables)
    schemas.py         Pydantic request models
    security.py        bcrypt hashing, JWT, decimal helpers
    deps.py            auth dependencies, pagination, kitchen scoping
    errors.py          typed errors and DB-constraint translation
    seed.py            schema bootstrap + demo dataset
    services/
      inventory.py     the stock engine - the only writer of balances
      operations.py    receipts, transfers, production, wastage, adjustments
      units.py         dimension-aware unit conversion
      numbering.py     document numbering (TRF-00001, PRD-00001, …)
      audit.py         audit log writer
    routers/           one module per resource
  Dockerfile           the image the API runs as
  worker/index.ts      Cloudflare front door - forwards to the container
  wrangler.jsonc       Cloudflare Containers deployment config
frontend/
  src/
    app/               Next.js App Router pages
      (protected)/     everything behind the auth guard
    components/        Layout, UI kit, line-item editor
    lib/               API client, auth context, hooks, formatting
  vercel.json          Vercel deployment config
docker-compose.yml
DEPLOYMENT.md
```

Each service carries its own deployment config, its own `.env.example` and its
own `.gitignore`. `backend/` has a small `package.json` purely for the Cloudflare
CLI — the API itself is Python, and `.dockerignore` keeps the Node side out of
the image.

---

## Database notes

The database is **PostgreSQL** (Supabase in production, plain PostgreSQL
locally). CockroachDB still works — pass a `cockroachdb+psycopg://` URL — and
the notes below explain why the schema looks the way it does, which is mostly
because it was written to satisfy both.

* **Primary keys come from explicit sequences**, not `SERIAL`. CockroachDB backs
  `SERIAL` with `unique_rowid()`, whose values exceed JavaScript's safe integer
  range (2^53−1) and would silently lose precision in the browser. PostgreSQL
  does not have that problem, but the sequences are portable and cost nothing,
  so they stayed.
* **Quantities and money are `DECIMAL`**, never floating point. Stock is counted
  in each item's base unit to four decimal places.
* **"Only one active row" rules** (one active recipe per product, one active
  assignment per manager/kitchen) use a nullable `active_key` column inside a
  plain `UNIQUE` constraint. NULLs do not collide in a unique index, so at most
  one row per group can hold `TRUE` — portable, without dialect-specific partial
  indexes.
* `SUM()` returns `DECIMAL` on both engines, and CockroachDB type-checks `CASE`
  branches strictly, so aggregate fallbacks are decimals rather than integer
  literals.
* Date filters bind as real dates rather than strings: CockroachDB will not
  compare `DATE` to `VARCHAR`, and PostgreSQL only gets away with it by casting.
* **Conflicts are retried, not raised.** Every stock-changing operation runs
  through `run_in_transaction()`, which replays serialization failures (`40001`)
  and deadlocks (`40P01`) with exponential backoff. Two kitchens touching the
  same item at once is a retry, not an error.

### Connecting to Supabase

Use the **session pooler** string for a long-running server:

```
DATABASE_URL=postgresql+psycopg://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

The transaction pooler (port `6543`) is for serverless. The app detects it and
turns off prepared statements and its own connection pool, because in that mode
a connection is only yours for one transaction. The direct
`db.<ref>.supabase.co` host is **IPv6-only** and will fail from an IPv4-only
host — prefer a pooler.

### Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md): Vercel for the web app, Cloudflare
Containers for the API, Supabase for the database.

### Pointing at CockroachDB instead

```
DATABASE_URL=cockroachdb+psycopg://<user>:<password>@<host>:26257/kitchenstock?sslmode=verify-full
```

---

## Configuration

Each service owns its environment file; neither is committed.

* `backend/.env` — see [`backend/.env.example`](backend/.env.example)
  (`DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, pool and retry settings).
* `frontend/.env.local` — see [`frontend/.env.example`](frontend/.env.example)
  (`NEXT_PUBLIC_API_URL`).

Before deploying: set a real `JWT_SECRET`
(`python -c "import secrets; print(secrets.token_urlsafe(48))"`), set
`DEBUG=false` (which also hides the API docs), and restrict `CORS_ORIGINS` to
your real frontend origin.

---

## Useful commands

```bash
# reset the database and reload the demo dataset
cd backend && python -m app.seed --reset
```

```bash
# create the schema and reference data without demo records
cd backend && SEED_DEMO_DATA=false python -m app.seed
```

```bash
# production build of the frontend
cd frontend && bun run build && bun run start
```
# client-inventorymanagementsystem
