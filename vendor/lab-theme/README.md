# lab-theme

Shared LocDoc company theme for Lab Hub, PM, IT, and Employee Hub.

## Canonical reference (OMS)

The production MUI palette lives in the sibling repo:

**`LocDoc_OMS3/client/src/settings/theme.ts`**

| OMS token | Value | Lab mapping |
|-----------|-------|----------------|
| `primary.main` (light) | `#4f6498` | `brand-600` / LocDoc Blue palette |
| `primary.main` (dark) | `#687eb1` | `brand-600` in `dark-blue` theme |
| `secondary.main` | `#64984f` | `brand-secondary-600` |
| `primary.backgroundColor` | `#E6E6EA` | `--theme-page-bg` (light) |
| `background.paper` | `#F4F4F8` | `--theme-slate-800` (light cards) |
| `TopBar.main` (light) | `#fefefe` | nav/surface |
| `TopBar.main` (dark) | `#353635` | `--theme-surface` (dark) |
| Typography | Open Sans | `--font-sans` |

## Usage in Lab apps

Each app `src/index.css`:

```css
@import "tailwindcss";
@import "lab-theme/lab-theme.css";
@import "lab-theme/components.css";
```

```json
"lab-theme": "file:../packages/lab-theme"
```

## Verify

```bash
node packages/lab-theme/scripts/verify-theme.mjs
```

## When OMS adds new brand tokens

1. Update `LocDoc_OMS3/client/src/settings/theme.ts` (source of truth for MUI apps)
2. Mirror values in `src/tokens.ts` and `src/lab-theme.css`
3. Update `LAB_STANDARDS.md` in Lab_Hub

## OMS hybrid sidebar

Import `LabSideNav` from `lab-theme/LabSideNav`:

- **Quick links** (top band): softer weight, `#333` text, blue icons
- **Green divider**: `#64984f`
- **Collapsible groups**: bold `#111` labels, green icons, bordered rows

## Text / ghost buttons

Use `.btn-text` or `.btn-ghost` for label-only actions on page background — `#111111` in light mode.
