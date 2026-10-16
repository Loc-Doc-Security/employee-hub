# Lab Hub platform (Employee Hub)

This app was created with **LocDoc Hub + shared Postgres**.

You can still run it **standalone on SQLite**. Shared Postgres is opt-in.

## Standalone SQLite (default)

```bash
cp .env.example .env.local
npm install
npm run dev
```

Local login: **admin** / **admin**.

This app’s state lives in its own SQLite file. It does **not** use Hub or the shared database.

## Shared Lab Postgres + Hub login

This app gets its **own schema** (`employee_hub`) on the same Postgres database as Hub, PM, and IT. It does not write into `hub`, `pm`, or `it`.

### 1. Start local Postgres (workspace root)

```bash
cd ../Lab\ Hub\ System   # adjust if your workspace path differs
./scripts/db/bootstrap.sh up
```

### 2. Register in Hub (one-time)

```bash
./scripts/register-with-hub.sh employee-hub "Employee Hub"
```

Or add the app in Hub admin. A SUPER_ADMIN enables entitlements for the LocDoc provider.

### 3. Run against shared Postgres

```bash
npm run dev:postgres
```

Open the app from the Hub launcher at `http://localhost:3002` (hub-exchange login).

Copy `.env.postgres.example` if you want those values in `.env.local`.

## Local dev ports (do not collide)

LocDoc reserves these on a developer machine:

| App | Local `PORT` |
|-----|----------------|
| Lab PM | **3000** |
| Lab IT | **3001** |
| Lab Hub | **3002** |

Your app should use a **different** port in the 3000–3999 range. The setup wizard (and `npm run suggest-dev-port` in the Lab Hub monorepo) picks the next free port by scanning the workspace.

Production on ECS is different: satellite containers usually listen on **3000** inside the task (ALB uses hostnames, not unique container ports).

## Hub launcher (production)

After deploy, LocDoc adds your tile in **Hub → Admin → Launcher apps** (name, URL, icon, postgres/sqlite metadata). You do not edit Hub code for a new tile.

For local Postgres dev, `register-with-hub.sh` seeds `hub.app_registry`; a SUPER_ADMIN still enables entitlements for the LocDoc provider.

## Production (ECS) — consolidated platform

Hub, PM, and IT use a **single** Secrets Manager JSON (**`Lab-Hub-Secrets`**) loaded at runtime via `LAB_PLATFORM_SECRET_ARN`. Satellite apps follow the same pattern as LocDoc rolls them onto `lab-platform-config`.

**Already written into this app at setup**

The image bakes the non-secret production settings and the Secrets Manager ARN. Passwords are not in the image or the repo.

- `NODE_ENV=production`, `PORT=3000`, `AWS_REGION=us-east-1`
- `DATA_BACKEND=postgres`, `DATABASE_SSL=1`, `EMPLOYEE_HUB_DB_SCHEMA=employee_hub`
- `HUB_AUTH_ENABLED=1`, `HUB_JWT_ISSUER=lab-hub`, `HUB_APP_URL=https://lab-hub.locdoc.net`
- `LAB_PLATFORM_SECRET_ARN` for **`Lab-Hub-Secrets`**

On startup the app reads that ARN and loads `DATABASE_URL`, `HUB_JWT_SECRET`, and the other shared keys from AWS. Put the same ARN on the ECS task as a plain environment value if you want it visible there. Do not store the whole secret JSON with `valueFrom`.

**You (app team) provide**

- Container image (ECR). The Dockerfile already has the settings above.
- Production URL, e.g. `https://employee-hub.locdoc.net` (DNS/ALB by LocDoc)
- Any **app-only** secrets LocDoc should add to the shared JSON (rare)

**LocDoc operator provides**

- ECS service + ALB + `containerPort` **3000**
- Task role with `secretsmanager:GetSecretValue` on `Lab-Hub-Secrets`
- Shared JSON keys: `DATABASE_URL`, `HUB_JWT_SECRET` (same value everywhere), Google OAuth if applicable
- Launcher tile + user entitlements in Hub admin

**Local dev only**

- `DEV=true` in `.env.local`
- Optional overrides (`PORT`, `DATABASE_URL`, `HUB_JWT_SECRET` for local handoff scripts)

### Shared RDS (recommended for platform apps)

- `DATA_BACKEND=postgres` and `EMPLOYEE_HUB_DB_SCHEMA=employee_hub` in production (set by platform config when wired)
- `DATABASE_URL` lives in **`Lab-Hub-Secrets`**, not in your repo
- Do **not** use `SQLITE_DB_PATH` on shared RDS deployments

### Standalone SQLite on ECS (optional)

Only if LocDoc agrees to host your app **outside** the shared Postgres database: `DATA_BACKEND=sqlite` + EFS path. This is not the default for new platform-integrated apps.

## Product database (wizard step)

That optional extra database is for **feature data**, not app login/shell state. If this app uses shared Lab Postgres for shell state, keep the product-database choice as **none** unless you truly need a second engine.
