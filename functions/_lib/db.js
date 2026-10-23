import { ApiError } from "./auth.js";

export async function loadAppState(db) {
  const [seasonRows, memberRows, attendanceRows, paymentRows] = await Promise.all([
    db.prepare("SELECT id, name, closed, imported, is_current FROM seasons ORDER BY id").all(),
    db.prepare("SELECT id, name FROM members WHERE is_active = 1 ORDER BY sort_order").all(),
    db.prepare("SELECT g.id, g.season_id, g.date, g.activity, g.notes, a.member_id, a.present FROM gatherings g LEFT JOIN attendance a ON a.gathering_id = g.id ORDER BY g.date, g.id, a.member_id").all(),
    db.prepare("SELECT season_id, member_id, paid_on FROM beer_payments WHERE reversed_at IS NULL ORDER BY paid_on, id").all()
  ]);
  const members = memberRows.results || [];
  const seasons = new Map((seasonRows.results || []).map((row) => [row.id, {
    id: row.id,
    name: row.name,
    closed: !!row.closed,
    imported: !!row.imported,
    sessions: [],
    paid: Object.fromEntries(members.map((member) => [member.id, []]))
  }]));
  const gatherings = new Map();
  for (const row of attendanceRows.results || []) {
    let gathering = gatherings.get(row.id);
    if (!gathering) {
      gathering = { id: row.id, seasonId: row.season_id, session: { id: row.id, date: row.date, activity: row.activity, notes: row.notes || "", att: Object.fromEntries(members.map((member) => [member.id, false])) } };
      gatherings.set(row.id, gathering);
      const season = seasons.get(row.season_id);
      if (season) season.sessions.push(gathering.session);
    }
    if (row.member_id && Object.hasOwn(gathering.session.att, row.member_id)) gathering.session.att[row.member_id] = !!row.present;
  }
  for (const row of paymentRows.results || []) {
    const season = seasons.get(row.season_id);
    if (season && season.paid[row.member_id]) season.paid[row.member_id].push(row.paid_on);
  }
  for (const season of seasons.values()) season.sessions.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return {
    seasons: [...seasons.values()],
    members,
    currentSeasonId: ((seasonRows.results || []).find((row) => row.is_current) || {}).id || null
  };
}

export async function currentSeason(db) {
  const season = await db.prepare("SELECT id, name FROM seasons WHERE is_current = 1 AND imported = 0 AND closed = 0 LIMIT 1").first();
  if (!season) throw new ApiError(409, "There is no open season.");
  return season;
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateGathering(body, memberIds) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Gathering data is required.");
  const date = body.date;
  const activity = typeof body.activity === "string" ? body.activity.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (!validDate(date)) throw new ApiError(400, "Choose a valid gathering date.");
  if (!activity || activity.length > 120) throw new ApiError(400, "Activity must be between 1 and 120 characters.");
  if (notes.length > 500) throw new ApiError(400, "Notes must be 500 characters or fewer.");
  if (!body.attendance || typeof body.attendance !== "object" || Array.isArray(body.attendance)) throw new ApiError(400, "Attendance for every active member is required.");
  const attendance = {};
  for (const id of memberIds) {
    if (typeof body.attendance[id] !== "boolean") throw new ApiError(400, "Attendance for every active member is required.");
    attendance[id] = body.attendance[id];
  }
  if (Object.keys(body.attendance).length !== memberIds.length) throw new ApiError(400, "Attendance data contains an unknown member.");
  return { date, activity, notes, attendance };
}
