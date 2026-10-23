import { authConfiguration, json, redirect } from "../_lib/auth.js";

function stateCookie(value) {
  return `brotime_oauth_state=${value}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export async function onRequest({ request, env }) {
  const config = authConfiguration(env);
  if (!config.configured) return json({ error: "Discord sign-in is not configured yet.", missing: config.missing }, 503);
  const state = crypto.randomUUID();
  const redirectUri = new URL("/auth/callback", request.url).toString();
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  return redirect(url.toString(), { "set-cookie": stateCookie(state), "cache-control": "no-store" });
}
