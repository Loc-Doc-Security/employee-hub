# Product databases (optional)

At setup (wizard or CLI) you can attach a **product** database starter kit.

App shell / auth state defaults to SQLite (`DATA_BACKEND=sqlite`). If you chose **LocDoc Hub + shared Postgres** at setup, you can also run `DATA_BACKEND=postgres` so shell state lives in this app's own schema on the same Lab database as Hub/PM/IT. The product DB below is a separate optional engine for feature data.

## Categories

| Category | Engines |
|----------|---------|
| None | No extra product DB (default) |
| SQL | `sqlite-file`, `postgres`, `mysql`, `mssql` |
| Non-relational | `mongodb`, `redis` |
| Specialized | `elasticsearch`, `neo4j` |
| Other | Free-text name + empty `DATABASE_URL` |

## After init

```bash
cp .env.example .env.local
docker compose up -d   # if your engine needs Docker
npm install
npm run dev
```

Health: `GET /api/health` may include `productDb: "skipped"|"ok"|"error"` without blocking boot when the DB is down.
