# HARD RULES — apps from Lab_App_TEMPLATE

Read [`LAB_STANDARDS.md`](LAB_STANDARDS.md) first.

## Platform contracts

| Item | Value |
|------|-------|
| API envelope | `{ ok, data }` / `{ ok: false, error }` |
| Health | `GET /api/health` → 200 |
| Logo path | `/lab-logo.png` |
| Theme | `lab-theme` imports only |
| Product title | `PRODUCT_NAME` from `src/lib/brand.ts` |

When attaching to Hub later (ops-owned):

| Item | Value |
|------|-------|
| JWT issuer | `lab-hub` |
| URL handoff | `?hub_token=` |
| App id | your slug from init |

## Protected patterns (do not delete)

Keep Hub JWT client, auth token helpers, theme entry CSS, and health endpoint working if you extend the app. Prefer extending over rewriting auth/theme bootstrap.

## Safe to extend

- Product routes, pages, components
- In-app roles and business logic
- Optional Socket.IO events
- New env vars in `.env.example`
