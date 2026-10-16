# LocDoc Lab platform — what to tell app developers

Use this when someone builds a **satellite** or **partner** app with `Lab_App_Template` and **locdoc-platform** integration.

## One-minute version

1. **Local:** `DEV=true`, use the wizard’s **suggested dev port** (not 3000 / 3001 / 3002). Sign in through Hub at `http://localhost:3002`.
2. **Secrets:** You do **not** create your own `lab/my-app-env` in AWS. Choosing **locdoc-platform** at setup bakes `LAB_PLATFORM_SECRET_ARN` and the other non-secret production settings into the app. At startup the app loads `DATABASE_URL`, `HUB_JWT_SECRET`, and the rest from **`Lab-Hub-Secrets`**. Passwords are not written into the repo or the image.
3. **Production URL:** You ship an image; LocDoc wires DNS, ECS, ALB, and adds a **Launcher apps** tile in Hub admin.
4. **JWT:** Production uses the shared `HUB_JWT_SECRET` from that JSON (same as Hub/PM/IT). Local dev uses the documented dev secret in `dev:postgres` scripts.

## Reserved local ports

| Service | Port |
|---------|------|
| Lab PM | 3000 |
| Lab IT | 3001 |
| Lab Hub | 3002 |

Everyone else: next free port in **3000–3999** (wizard or monorepo `npm run suggest-dev-port`).

## What developers configure vs what LocDoc configures

| Developer | LocDoc operator |
|-----------|-----------------|
| App repo, tests, ECR image | ECS service, ALB, TLS, `containerPort` |
| App created with **locdoc-platform** (ARN and production env already in the image) | ECS task role that can read `Lab-Hub-Secrets` |
| Schema name + migrations for their app | `DATABASE_URL` + `HUB_JWT_SECRET` in `Lab-Hub-Secrets` |
| Ask for launcher title, URL, icon | Hub **Admin → Launcher apps** + entitlements |
| Document any extra secret keys needed | Merge keys into `Lab-Hub-Secrets` |

Do **not** ask developers to set on ECS: `AWS_REGION`, `HUB_APP_URL`, `HUB_JWT_ISSUER`, `ALLOWED_EMAIL_DOMAINS`, or duplicate `PORT` in Secrets Manager (first-party apps embed these; satellites use **3000** in the image).

## Checklist for a new satellite

- [ ] Template setup with **locdoc-platform**
- [ ] Unique local dev port (wizard default)
- [ ] `npm run dev:postgres` works with Hub handoff
- [ ] Production image builds; health check on `/health`
- [ ] Send LocDoc: slug, production URL, ECR repo name, Postgres schema name, launcher copy (title/description)
- [ ] LocDoc: deploy ECS, add launcher row, enable provider entitlements

## Deeper detail

See the generated app’s `PLATFORM_DEV.md` (from the locdoc-platform preset).
