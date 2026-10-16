# Agent instructions — Employee Hub

## App identity
- Product name: `Employee Hub`
- JWT / Hub app id: `employee-hub`
- Package: `employee-hub`

## Build with LocDoc standards
- Follow `docs/LAB_STANDARDS.md` and `docs/NAMING.md`
- Use `PRODUCT_NAME` from `src/lib/brand.ts` for UI titles
- Theme: `vendor/lab-theme` (`npm run sync-theme` if you have a theme source)

## Scope
- Implement features in this repo
- Hub launcher / JWT wiring is handled by LocDoc ops when you are ready to attach

## Local auth
- After `cp .env.example .env.local`, login is **admin** / **admin**
