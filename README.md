# Brotime Attendance Tribunal

A public attendance and beer-obligation tracker for five members: Sterling, Adam, Julian, Nathan, and Isaiah.

## Rules

- Every missed gathering adds one strike, regardless of reason.
- Each fifth accumulated strike creates one beer obligation and resets that member's active strike count to zero.
- Fulfilling a beer obligation does not change strikes.
- Each year starts empty. Historical records must remain separate and must never affect live totals.

## Local preview

The production app uses Pages Functions to read and write data. A plain static server cannot provide those API routes; it only serves the source files:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. The source runner fetches its files over HTTP, so opening `index.html` directly as a `file://` URL will not work. The local server cannot provide live D1 reads or writes.

## Source layout

- `index.html` starts the app.
- `src/app/` contains the six existing application layers: configuration, rules, data, actions, selectors, and component glue. The runtime joins them in order.
- `src/app.css` and `src/template.html` hold the presentation and page structure.
- `src/bundle/` contains generated runtime, React, and font assets from the packaged prototype. Treat `manifest.json` as generated data; the bundled font license is kept in `FONT-LICENSE.txt`.
- `scripts/prototype-runtime.js` loads the split files and assembles the page.
- `prototype/Brotime_Tribunal.html` is the portable, bundled copy of the prototype.

The live app reads the current year and its attendance from Cloudflare D1. Gatherings record a category, game when the category is Video Games, and a location. Gathering edits, removals, year starts, and beer payments are written to D1 and reload from the server.

History has a separate, read-only Discord archive containing the original attendance log from September 2024 through June 2026. It preserves the cumulative snapshots and notes without changing current D1 attendance, strikes, or beer totals.

Anyone with the public Pages URL can view and edit the tracker. It has no sign-in gate.

## Cloudflare Pages setup

The project is a static site with Pages Functions. It has no framework build step or dependencies, so the Pages build command is blank and the output directory is the repository root. Bind the D1 database to the Pages Function using the binding name `DB`. Apply `migrations/0002_event_details_and_years.sql` once to add game and location fields and rename the current season to its year.

## Checks

Run the focused D1 API checks with Node.js 24 or newer:

```sh
node --test scripts/d1-api.test.mjs
```
