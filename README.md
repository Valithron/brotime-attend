# Brotime Attendance Tribunal

A private attendance and beer-obligation tracker for five active members: Sterling, Adam, Julian, Nathan, and Isaiah.

## Rules

- Every missed gathering adds one strike, regardless of reason.
- Each fifth accumulated strike creates one beer obligation and resets that member's active strike count to zero.
- Fulfilling a beer obligation does not change strikes.
- Season 1 starts empty. Historical Discord records must remain separate and must never affect live totals.

## Prototype

`prototype/Brotime_Tribunal.html` preserves the accepted Claude design and interactions. It opens directly in a browser. The page starts with an empty Season 1; the existing demo-data control remains available for evaluation. Prototype changes live only in the browser and disappear on refresh.

This file is a generated, bundled HTML artifact. It is the visual and behavioral reference for source extraction; it is not yet the production application.

## Production status

The repository does not yet have persistent storage, Discord sign-in, server-enforced roles, or Cloudflare deployment. The prototype's Admin / Member view is only a preview and does not provide access control.

## Next implementation steps

1. Extract the prototype into maintainable source files while preserving its layout, navigation, and interactions.
2. Add Cloudflare D1 persistence and enforce attendance and ledger rules on the server.
3. Add Discord authentication, with administrator actions restricted to the designated administrator and member views read-only.
4. Deploy through Cloudflare Pages and verify the first production season is empty.
