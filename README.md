# Brotime Attendance Tribunal

A private attendance and beer-obligation tracker for five active members: Sterling, Adam, Julian, Nathan, and Isaiah.

## Rules

- Every missed gathering adds one strike, regardless of reason.
- Each fifth accumulated strike creates one beer obligation and resets that member's active strike count to zero.
- Fulfilling a beer obligation does not change strikes.
- Season 1 starts empty. Historical Discord records must remain separate and must never affect live totals.

## Run locally

From the repository root, start a static server:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. The source runner fetches its files over HTTP, so opening `index.html` directly as a `file://` URL will not work.

## Source layout

- `index.html` starts the editable prototype.
- `src/app/` contains the six existing application layers: configuration, rules, data, actions, selectors, and component glue. The runtime joins them in order.
- `src/app.css` and `src/template.html` hold the presentation and page structure.
- `src/bundle/` contains generated runtime, React, and font assets from the packaged prototype. Treat `manifest.json` as generated data; the bundled font license is kept in `FONT-LICENSE.txt`.
- `scripts/prototype-runtime.js` loads the split files and assembles the page.
- `prototype/Brotime_Tribunal.html` is the portable, bundled copy of the prototype.

The app starts with an empty Season 1. The existing demo-data control remains available for evaluation. Prototype changes live only in the browser and disappear on refresh.

## Production status

The prototype does not yet have persistent storage, Discord sign-in, server-enforced roles, or Cloudflare deployment. Its Admin / Member view is only a preview and does not provide access control.

## Next implementation steps

1. Replace the prototype packaging runtime with a conventional production build and add focused checks for the attendance and ledger rules.
2. Add Cloudflare D1 persistence and enforce attendance and ledger rules on the server.
3. Add Discord authentication, with administrator actions restricted to the designated administrator and member views read-only.
4. Deploy through Cloudflare Pages and verify the first production season is empty.
