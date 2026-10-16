# App naming (from this template)

You choose the product name when running `./scripts/init-app.sh`.

**Type your real product name.** Do not leave example names (Accounting, Fleet, …) as the final name.

## Derived names

```bash
./scripts/init-app.sh --name "YourAppName"
```

| Layer | Pattern | Example (`YourAppName` → Accounting) |
|-------|---------|--------------------------------------|
| Display title (`PRODUCT_NAME`) | `{Name}` as typed | Accounting |
| Slug / Hub app id | lowercase hyphenated | `accounting` |
| npm package | `{slug}` | `accounting` |
| Dev folder | the clone you initialized | whatever you cloned as |
| Suggested production host | `https://{slug}.locdoc.net` | `https://accounting.locdoc.net` |

No `Lab_` / `Lab ` prefix is added by this template.

## Reserved slugs

`hub`, `pm`, `it`, `employee` (and `lab-hub`, `lab-pm`, `lab-it`) — already used by core LocDoc products.

## Theme

Use vendored `lab-theme` and UI patterns from LAB_STANDARDS. Titles in the UI should use `PRODUCT_NAME` from `src/lib/brand.ts`.
