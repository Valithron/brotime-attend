export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const encoder = new TextEncoder();
const SESSION_COOKIE = "brotime_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

export function authConfiguration(env) {
  const missing = [];
  if (!env.DISCORD_CLIENT_ID) missing.push("DISCORD_CLIENT_ID");
  if (!env.DISCORD_CLIENT_SECRET) missing.push("DISCORD_CLIENT_SECRET");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) missing.push("SESSION_SECRET");
  if (!env.ADMIN_DISCORD_ID) missing.push("ADMIN_DISCORD_ID");
  return { configured: missing.length === 0, missing };
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signature(payload, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signed));
}

function safeEqual(a, b) {
  let difference = a.length ^ b.length;
  const count = Math.max(a.length, b.length);
  for (let i = 0; i < count; i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

export async function makeSessionToken(discordId, secret, now = Date.now()) {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ id: String(discordId), exp: Math.floor(now / 1000) + SESSION_SECONDS })));
  return payload + "." + await signature(payload, secret);
}

async function readSessionToken(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !safeEqual(await signature(parts[0], secret), parts[1])) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    if (typeof payload.id !== "string" || !payload.id || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(now / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieValue(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

export function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return sessionCookie("", 0);
}

export async function userFromRequest(request, env) {
  const token = await readSessionToken(cookieValue(request, SESSION_COOKIE), env.SESSION_SECRET);
  if (!token || !env.DB) return null;
  const user = await env.DB.prepare(
    "SELECT u.discord_id, u.member_id, u.is_admin, m.name AS member_name FROM app_users u LEFT JOIN members m ON m.id = u.member_id WHERE u.discord_id = ? LIMIT 1"
  ).bind(token.id).first();
  if (!user || (!user.is_admin && !user.member_id)) return null;
  return {
    discordId: user.discord_id,
    memberId: user.member_id || null,
    memberName: user.member_name || null,
    role: user.is_admin ? "admin" : "member"
  };
}

export async function requireUser(request, env) {
  if (!env.DB) throw new ApiError(503, "Database binding DB is not available.");
  if (authConfiguration(env).missing.length) throw new ApiError(503, "Discord sign-in is not configured yet.");
  const user = await userFromRequest(request, env);
  if (!user) throw new ApiError(401, "Sign in with Discord to continue.");
  return user;
}

export async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (user.role !== "admin") throw new ApiError(403, "Administrator access is required.");
  return user;
}

export function requireSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new ApiError(403, "This request must come from the Brotime site.");
}

export async function readJson(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new ApiError(415, "Send JSON data.");
  }
  const text = await request.text();
  if (text.length > 65536) throw new ApiError(413, "Request is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
}

export function redirect(url, headers = {}) {
  return new Response(null, { status: 302, headers: { location: url, ...headers } });
}
