# Brotime Attendance Tribunal

A private attendance and beer-obligation tracker for five active members: Sterling, Adam, Julian, Nathan, and Isaiah.

## Rules

- Every missed gathering adds one strike, regardless of reason.
- Each fifth accumulated strike creates one beer obligation and resets that member's active strike count to zero.
- Fulfilling a beer obligation does not change strikes.
- Season 1 starts empty. Historical Discord records must remain separate and must never affect live totals.

## Local preview

The production app uses Pages Functions for sign-in and data access. A plain static server cannot provide those API routes; it only serves the source files and displays a note that Pages Functions are unavailable:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. The source runner fetches its files over HTTP, so opening `index.html` directly as a `file://` URL will not work.

## Source layout

- `index.html` starts the app.
- `src/app/` contains the six existing application layers: configuration, rules, data, actions, selectors, and component glue. The runtime joins them in order.
- `src/app.css` and `src/template.html` hold the presentation and page structure.
- `src/bundle/` contains generated runtime, React, and font assets from the packaged prototype. Treat `manifest.json` as generated data; the bundled font license is kept in `FONT-LICENSE.txt`.
- `scripts/prototype-runtime.js` loads the split files and assembles the page.
- `prototype/Brotime_Tribunal.html` is the portable, bundled copy of the prototype.

The live app reads Season 1 and its attendance from Cloudflare D1. Gathering edits, removals, season starts, and beer payments are written to D1 and reload from the server.

## Cloudflare Pages setup

The project is a static site with Pages Functions. It has no framework build step or dependencies, so the Pages build command is blank and the output directory is the repository root. Bind the D1 database to the Pages Function using the binding name `DB`.

Set these production variables in the Pages project:

- `DISCORD_CLIENT_ID`: the Discord OAuth application client ID.
- `DISCORD_CLIENT_SECRET`: the Discord OAuth application secret.
- `SESSION_SECRET`: a random secret of at least 32 characters.
- `ADMIN_DISCORD_ID`: the designated administrator's Discord user ID.

Register `https://brotime-attend.pages.dev/auth/callback` as an OAuth2 redirect URL in the Discord application. The administrator account is created in `app_users` on its first successful sign-in. Add each member's Discord user ID to `app_users` with their member ID (`s`, `a`, `j`, `n`, or `i`) to grant read-only access. Until the bindings and variables are configured, the app keeps the live tracker behind the sign-in screen.

## Checks

Run the focused D1 API checks with Node.js 24 or newer:

```sh
node --test scripts/d1-api.test.mjs
```
