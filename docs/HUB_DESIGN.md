# Employee Hub design

The OMST theme (`vendor/lab-theme`) is the umbrella. The hub adds a layer underneath it, in
`src/styles/hub.css`, that brings back the feel of the old Teamwix hub
(`locdoc-hub-ui/src/elements/tokens.js`) without changing the theme. Decided by Levi, 2026-10-19.

## Rules

1. **Never edit `vendor/lab-theme`.** Theme updates must drop in cleanly. Anything the hub wants
   different goes in `src/styles/hub.css`, scoped to `.hub-shell`.
2. **Only theme variables for color** (`--theme-*`, `--text-*`), so light, dark and every OMST
   palette keep working. No hard-coded hex except white text on a brand fill.
3. **The theme is dark-first: Tailwind's slate scale is inverted in light mode.** Write greys the
   theme's way:

   | You want (light mode) | Write |
   |---|---|
   | card / surface | `bg-slate-900` (or `hub-card`) |
   | faint fill | `bg-slate-800` |
   | light border / divider | `border-slate-700` (row dividers: `border-slate-800`) |
   | medium border, faint text | `border-slate-600`, `text-slate-600` |
   | secondary text | `text-slate-500` |
   | body-strength grey text | `text-slate-400` |
   | strong text | `text-slate-200` / `text-slate-100` |
   | white text on a colored fill | `text-[#fff]` (`text-white` turns dark in light mode) |

4. **Blue is the action color** (OMST): buttons (`btn-brand`), selected tabs, active nav, focus
   rings. **Green is the identity color** (OMST secondary): icon chips and accents.
5. **Corners are OMS-size**: 8–10px. `rounded-xl` / `rounded-2xl` are capped to that inside the app.
6. **Buttons follow OMST** (uppercase brand buttons, `btn-text` for quiet actions).

## Building blocks (`src/styles/hub.css`)

| Class | Use |
|---|---|
| `hub-card` | Solid card (OMST's `glass-card` is also rendered solid inside the app) |
| `hub-section-title` | Small uppercase label with a rule, above a group |
| `hub-icon-chip` (`--sm`, `--lg`) | Green-tinted square behind a lucide icon |
| `hub-tiles` + `hub-tile` + `hub-tile__name` | Icon-forward tool tiles that lift on hover |
| `hub-page-header` | Icon chip + title + one-line description. Use the `PageTitle` component (`src/components/PageTitle.tsx`): it takes the page's icon from `nav.ts`, so the title matches its tile |

## Navigation

- One list of destinations: `src/lib/nav.ts` (`HOME`, `NAV_GROUPS`: My work, Company, Manager, Admin,
  each item with an icon, a one-line description and an optional permission). The sidebar, the
  icon rail and the Home tiles all read it. **Add a new page there**, not in three places.
- `src/components/HubShell.tsx`: on desktop a slim icon rail is always there. Expanding opens the
  OMST sidebar (`LabSideNav`, unchanged) as a full-height panel that floats over the page (closes
  on navigate, click outside or Esc); the pin button docks it beside the page instead (remembered
  per browser). The whole panel scrolls as one, rows are a little tighter than OMST's, and only
  the current page's group starts open. On phones, a top bar with ☰ opens the same panel as a drawer.
- Home's grouped tiles are the main way around; the rail is for jumping between pages.

## Logos

- **Employee Hub mark:** `public/lab-logo.png` (the template's logo path): browser tab icon, sign-in
  page, top of the icon rail, and beside the company logo in the menu and the phone top bar.
- **Company logo:** `public/logos/<company slug>.png`, shown for the signed-in person's company (Loc-Doc now, Buffalo
later); falls back to the product name.

## Known theme issue (for the OMST owner)

`btn-brand` uses Tailwind's `text-white`, which the theme maps to dark text in light mode, so brand
button labels come out dark on blue. The hub forces them white; worth fixing in lab-theme itself.
