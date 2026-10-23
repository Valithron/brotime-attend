import { ApiError, authConfiguration, json, readJson, requireAdmin, requireSameOrigin, requireUser, userFromRequest } from "../_lib/auth.js";
import { currentSeason, loadAppState, validateGathering } from "../_lib/db.js";

async function sessionResponse(request, env) {
  const config = authConfiguration(env);
  const user = config.configured ? await userFromRequest(request, env) : null;
  return json({ authenticated: !!user, configured: config.configured, user: user ? {
    role: user.role,
    memberId: user.memberId,
    memberName: user.memberName
  } : null });
}

async function writeGathering(request, env, user, existingId = null) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const memberRows = await env.DB.prepare("SELECT id FROM members WHERE is_active = 1 ORDER BY sort_order").all();
  const memberIds = (memberRows.results || []).map((row) => row.id);
  const gathering = validateGathering(body, memberIds);
  const season = await currentSeason(env.DB);
  const duplicate = await env.DB.prepare(
    "SELECT id FROM gatherings WHERE season_id = ? AND date = ? AND activity = ? COLLATE NOCASE AND id != COALESCE(?, -1) LIMIT 1"
  ).bind(season.id, gathering.date, gathering.activity, existingId).first();
  if (duplicate) throw new ApiError(409, "A gathering with that date and activity already exists.");

  let statements;
  if (existingId == null) {
    statements = [env.DB.prepare(
      "INSERT INTO gatherings (season_id, date, activity, notes, created_by_discord_id) VALUES (?, ?, ?, ?, ?) RETURNING id"
    ).bind(season.id, gathering.date, gathering.activity, gathering.notes, user.discordId)];
    for (const memberId of memberIds) {
      statements.push(env.DB.prepare(
        "INSERT INTO attendance (gathering_id, member_id, present, recorded_by_discord_id) SELECT id, ?, ?, ? FROM gatherings WHERE season_id = ? AND date = ? AND activity = ? COLLATE NOCASE ON CONFLICT (gathering_id, member_id) DO UPDATE SET present = excluded.present, recorded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), recorded_by_discord_id = excluded.recorded_by_discord_id"
      ).bind(memberId, gathering.attendance[memberId] ? 1 : 0, user.discordId, season.id, gathering.date, gathering.activity));
    }
  } else {
    const exists = await env.DB.prepare("SELECT id FROM gatherings WHERE id = ? AND season_id = ? LIMIT 1").bind(existingId, season.id).first();
    if (!exists) throw new ApiError(404, "Gathering not found in the current season.");
    statements = [env.DB.prepare(
      "UPDATE gatherings SET date = ?, activity = ?, notes = ? WHERE id = ? AND season_id = ?"
    ).bind(gathering.date, gathering.activity, gathering.notes, existingId, season.id)];
    for (const memberId of memberIds) {
      statements.push(env.DB.prepare(
        "INSERT INTO attendance (gathering_id, member_id, present, recorded_by_discord_id) VALUES (?, ?, ?, ?) ON CONFLICT (gathering_id, member_id) DO UPDATE SET present = excluded.present, recorded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), recorded_by_discord_id = excluded.recorded_by_discord_id"
      ).bind(existingId, memberId, gathering.attendance[memberId] ? 1 : 0, user.discordId));
    }
  }
  const results = await env.DB.batch(statements);
  let id = existingId;
  if (id == null) id = results[0]?.results?.[0]?.id || results[0]?.meta?.last_row_id;
  if (!id) {
    const row = await env.DB.prepare("SELECT id FROM gatherings WHERE season_id = ? AND date = ? AND activity = ? COLLATE NOCASE LIMIT 1").bind(season.id, gathering.date, gathering.activity).first();
    id = row?.id;
  }
  if (!id) throw new ApiError(500, "Gathering was saved but could not be reloaded.");
  return json({ ok: true, id, message: existingId == null ? "Gathering saved." : "Changes saved." });
}

async function createSeason(request, env, user) {
  requireSameOrigin(request);
  const season = await currentSeason(env.DB);
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM seasons WHERE imported = 0").first();
  const name = "Season " + (Number(count?.count || 0) + 1);
  await env.DB.batch([
    env.DB.prepare("UPDATE seasons SET closed = 1, is_current = 0, closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND is_current = 1").bind(season.id),
    env.DB.prepare("INSERT INTO seasons (name, closed, imported, is_current) VALUES (?, 0, 0, 1)").bind(name)
  ]);
  return json({ ok: true, message: name + " started." });
}

async function createPayment(request, env, user) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  if (!memberId) throw new ApiError(400, "Member is required.");
  const member = await env.DB.prepare("SELECT name FROM members WHERE id = ? AND is_active = 1 LIMIT 1").bind(memberId).first();
  if (!member) throw new ApiError(404, "Active member not found.");
  const season = await currentSeason(env.DB);
  await env.DB.prepare("INSERT INTO beer_payments (season_id, member_id, paid_on, recorded_by_discord_id) VALUES (?, ?, strftime('%Y-%m-%d', 'now'), ?)").bind(season.id, memberId, user.discordId).run();
  return json({ ok: true, message: member.name + " settled a beer." });
}

async function reversePayment(request, env, user) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  if (!memberId) throw new ApiError(400, "Member is required.");
  const season = await currentSeason(env.DB);
  const payment = await env.DB.prepare("SELECT id FROM beer_payments WHERE season_id = ? AND member_id = ? AND reversed_at IS NULL ORDER BY paid_on DESC, id DESC LIMIT 1").bind(season.id, memberId).first();
  if (!payment) throw new ApiError(404, "There is no payment to undo.");
  await env.DB.prepare("UPDATE beer_payments SET reversed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), reversed_by_discord_id = ? WHERE id = ? AND reversed_at IS NULL").bind(user.discordId, payment.id).run();
  const member = await env.DB.prepare("SELECT name FROM members WHERE id = ? LIMIT 1").bind(memberId).first();
  return json({ ok: true, message: "Payment reversed for " + (member?.name || "member") + "." });
}

async function deleteGathering(request, env, existingId) {
  requireSameOrigin(request);
  if (!/^\d+$/.test(existingId)) throw new ApiError(400, "Gathering id is invalid.");
  const season = await currentSeason(env.DB);
  const result = await env.DB.prepare("DELETE FROM gatherings WHERE id = ? AND season_id = ?").bind(Number(existingId), season.id).run();
  if (!result.meta?.changes) throw new ApiError(404, "Gathering not found in the current season.");
  return json({ ok: true, message: "Gathering deleted." });
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/api/session" && request.method === "GET") return sessionResponse(request, env);
  if (path === "/api/state" && request.method === "GET") {
    await requireUser(request, env);
    return json(await loadAppState(env.DB));
  }
  if (!path.startsWith("/api/")) throw new ApiError(404, "Route not found.");
  const user = await requireAdmin(request, env);
  if (path === "/api/gatherings" && request.method === "POST") return writeGathering(request, env, user);
  const gatheringMatch = path.match(/^\/api\/gatherings\/([^/]+)$/);
  if (gatheringMatch && request.method === "PUT") {
    if (!/^\d+$/.test(gatheringMatch[1])) throw new ApiError(400, "Gathering id is invalid.");
    return writeGathering(request, env, user, Number(gatheringMatch[1]));
  }
  if (gatheringMatch && request.method === "DELETE") return deleteGathering(request, env, gatheringMatch[1]);
  if (path === "/api/payments" && request.method === "POST") return createPayment(request, env, user);
  if (path === "/api/payments/reverse" && request.method === "POST") return reversePayment(request, env, user);
  if (path === "/api/seasons" && request.method === "POST") return createSeason(request, env, user);
  throw new ApiError(404, "Route not found.");
}

export async function onRequest({ request, env }) {
  try {
    if (!env.DB && new URL(request.url).pathname !== "/api/session") throw new ApiError(503, "Database binding DB is not available.");
    return await handle(request, env);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    const message = String(error?.message || "");
    if (/UNIQUE constraint failed|FOREIGN KEY constraint failed|CHECK constraint failed/i.test(message)) {
      return json({ error: "The change conflicts with existing data or violates a data rule." }, 409);
    }
    console.error("Brotime API error", error);
    return json({ error: "The server could not complete that request." }, 500);
  }
}
