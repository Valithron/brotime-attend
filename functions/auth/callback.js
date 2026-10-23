import { authConfiguration, json, makeSessionToken, redirect, sessionCookie } from "../_lib/auth.js";

function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

function expireStateCookie() {
  return "brotime_oauth_state=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

function fail(request, code) {
  const target = new URL("/", request.url);
  target.searchParams.set("auth_error", code);
  return redirect(target.toString(), { "set-cookie": expireStateCookie(), "cache-control": "no-store" });
}

export async function onRequest({ request, env }) {
  const config = authConfiguration(env);
  if (!config.configured || !env.DB) return json({ error: "Discord sign-in is not configured yet." }, 503);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = readCookie(request, "brotime_oauth_state");
  if (!code || !state || !savedState || state !== savedState) return fail(request, "state");

  const redirectUri = new URL("/auth/callback", request.url).toString();
  let token;
  try {
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      })
    });
    if (!response.ok) return fail(request, "discord");
    token = await response.json();
  } catch {
    return fail(request, "discord");
  }
  if (!token.access_token) return fail(request, "discord");

  let discordUser;
  try {
    const response = await fetch("https://discord.com/api/users/@me", { headers: { authorization: "Bearer " + token.access_token } });
    if (!response.ok) return fail(request, "discord");
    discordUser = await response.json();
  } catch {
    return fail(request, "discord");
  }
  if (!discordUser.id) return fail(request, "discord");

  if (discordUser.id === String(env.ADMIN_DISCORD_ID)) {
    await env.DB.prepare("INSERT INTO app_users (discord_id, is_admin) VALUES (?, 1) ON CONFLICT (discord_id) DO UPDATE SET is_admin = 1").bind(discordUser.id).run();
  }
  const appUser = await env.DB.prepare("SELECT is_admin, member_id FROM app_users WHERE discord_id = ? LIMIT 1").bind(discordUser.id).first();
  if (!appUser || (!appUser.is_admin && !appUser.member_id)) return fail(request, "not_allowed");

  const target = new URL("/", request.url);
  const response = redirect(target.toString(), { "set-cookie": expireStateCookie(), "cache-control": "no-store" });
  response.headers.append("set-cookie", sessionCookie(await makeSessionToken(discordUser.id, env.SESSION_SECRET)));
  return response;
}
