# BroTime Attendance

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

The Board includes a manual Copy weekly recap control. It formats the latest completed gathering as a compact Discord message with the fixed attendance mug, absent-member list, saved event details, and the public site link. It uses the browser clipboard only and shows the exact message in a selectable field if clipboard access fails.

History has a separate, read-only Discord records view for 68 gatherings from September 2024 through April 2026, plus the opening tally and follow-up notes. Attendance is reconstructed from consecutive strike snapshots where possible; each record also keeps the original strike and beer markers. Dates inferred from weekly updates and attendance that cannot be established are labeled. These records live in closed imported years and do not change the current tracker's attendance, strikes, or beer totals.

Anyone with the public Pages URL can view and edit the tracker. It has no sign-in gate.

## Cloudflare Pages setup

The project is a static site with Pages Functions. It has no framework build step or dependencies, so the Pages build command is blank and the output directory is the repository root. Bind the D1 database to the Pages Function using the binding name `DB`. Apply `migrations/0002_event_details_and_years.sql` once to add game and location fields and rename the current season to its year. Apply `migrations/0003_discord_history.sql` once to insert the parsed Discord records into separate closed imported years.

## Checks

Run the focused D1 API checks with Node.js 24 or newer:

```sh
node --test scripts/d1-api.test.mjs
```

### Static page generation

After editing `src/template.html`, `src/app.css`, or `src/app/*.js`, run `node scripts/build-site.mjs` and include the updated `index.html` and generated `assets/` files in the commit. Cloudflare still serves the repository root without a build command. The browser receives the assembled page, versioned local runtime/fonts/CSS, and starts loading live attendance immediately. Keep old hashed assets available for existing tabs.

Startup uses one combined runtime script and inline CSS. `/api/state?scope=live` returns non-imported years without the Discord archive; the complete archive loads after the first live update. A local saved view is marked as updating and cannot be shared or edited until live attendance refreshes. Static routes bypass Pages Functions through `_routes.json`. HTML has a 60-second browser cache; hashed assets remain immutable.

### Approved Discord share format

The bubbly pub-sketch mug is the approved share design. Preserve its three-line bubbly head, wavy rim, rounded handle, and heavy base. It has five fixed name rows with a nine-character interior, filled alphabetically from the bottom. Keep the whole drawing and attendance count in one Discord code block. Weekly and History recaps use the same renderer. Change the artwork only when explicitly requested.
