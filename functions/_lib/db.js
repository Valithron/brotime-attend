import { ApiError } from "./http.js";

export async function loadAppState(db) {
  const [seasonRows, memberRows, attendanceRows, paymentRows, discordRows, discordNoteRows] = await Promise.all([
    db.prepare("SELECT id, name, closed, imported, is_current FROM seasons ORDER BY id").all(),
    db.prepare("SELECT id, name, is_active FROM members ORDER BY sort_order").all(),
    db.prepare("SELECT g.id, g.season_id, g.date, g.activity, g.notes, g.game, g.location, a.member_id, a.present FROM gatherings g LEFT JOIN attendance a ON a.gathering_id = g.id ORDER BY g.date, g.id, a.member_id").all(),
    db.prepare("SELECT season_id, member_id, paid_on FROM beer_payments WHERE reversed_at IS NULL ORDER BY paid_on, id").all(),
    loadDiscordRecords(db),
    loadDiscordNotes(db)
  ]);
  const allMembers = memberRows.results || [];
  const members = allMembers.filter((member) => member.is_active == null || Number(member.is_active) !== 0);
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
      gathering = { id: row.id, seasonId: row.season_id, seenMembers: new Set(), session: { id: row.id, date: row.date, activity: row.activity, game: row.game || "", location: row.location || "", notes: row.notes || "", att: Object.fromEntries(members.map((member) => [member.id, false])) } };
      gatherings.set(row.id, gathering);
      const season = seasons.get(row.season_id);
      if (season) season.sessions.push(gathering.session);
    }
    if (row.member_id && Object.hasOwn(gathering.session.att, row.member_id)) {
      gathering.seenMembers.add(row.member_id);
      gathering.session.att[row.member_id] = !!row.present;
    }
  }
  for (const gathering of gatherings.values()) {
    gathering.session.attendanceComplete = members.every((member) => gathering.seenMembers.has(member.id));
  }
  for (const row of paymentRows.results || []) {
    const season = seasons.get(row.season_id);
    if (season && season.paid[row.member_id]) season.paid[row.member_id].push(row.paid_on);
  }
  for (const season of seasons.values()) season.sessions.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const discordEvents = new Map();
  for (const row of discordRows) {
    let event = discordEvents.get(row.id);
    if (!event) {
      event = {
        id: row.id,
        year: row.year,
        date: row.date,
        activity: row.activity,
        game: row.game || "",
        location: row.location || "",
        notes: row.notes || "",
        title: row.event_title,
        eventLabel: row.event_label || "",
        sourcePostedAt: row.source_posted_at || "",
        dateConfidence: row.date_confidence,
        sourceNote: row.source_note || "",
        attendance: {}
      };
      discordEvents.set(row.id, event);
    }
    if (row.member_id) {
      event.attendance[row.member_id] = {
        status: row.status,
        strikes: row.source_strikes == null ? null : Number(row.source_strikes),
        beerMarkers: row.beer_markers || ""
      };
    }
  }
  const discordNotes = new Map();
  for (const row of discordNoteRows) {
    let note = discordNotes.get(row.id);
    if (!note) {
      note = { id: row.id, date: row.note_date, type: row.note_type, text: row.body, sourcePostedAt: row.source_posted_at || "", tallies: {} };
      discordNotes.set(row.id, note);
    }
    if (row.member_id) {
      note.tallies[row.member_id] = {
        strikes: Number(row.source_strikes),
        beerMarkers: row.beer_markers || ""
      };
    }
  }
  return {
    seasons: [...seasons.values()],
    members,
    discordMembers: allMembers.map(({ id, name }) => ({ id, name })).sort((a, b) => {
      const order = { a: 0, n: 1, john: 2, j: 3, s: 4, i: 5 };
      return (order[a.id] ?? 99) - (order[b.id] ?? 99);
    }),
    discordEvents: [...discordEvents.values()],
    discordNotes: [...discordNotes.values()],
    currentSeasonId: ((seasonRows.results || []).find((row) => row.is_current) || {}).id || null
  };
}

async function loadDiscordRecords(db) {
  try {
    const result = await db.prepare(
      "SELECT g.id, s.name AS year, g.date, g.activity, g.notes, g.game, g.location, m.event_title, m.event_label, m.source_posted_at, m.date_confidence, m.source_note, a.member_id, a.status, a.source_strikes, a.beer_markers FROM seasons s JOIN gatherings g ON g.season_id = s.id JOIN discord_record_metadata m ON m.gathering_id = g.id LEFT JOIN discord_attendance a ON a.gathering_id = g.id WHERE s.imported = 1 ORDER BY g.date, g.id, a.member_id"
    ).all();
    return result.results || [];
  } catch (error) {
    if (/no such table: discord_(record_metadata|attendance)/i.test(String(error?.message || error))) return [];
    throw error;
  }
}

async function loadDiscordNotes(db) {
  try {
    const result = await db.prepare(
      "SELECT n.id, n.note_date, n.note_type, n.body, n.source_posted_at, t.member_id, t.source_strikes, t.beer_markers FROM discord_archive_notes n LEFT JOIN discord_archive_note_tallies t ON t.note_id = n.id ORDER BY n.note_date, n.id, t.member_id"
    ).all();
    return result.results || [];
  } catch (error) {
    if (/no such table: discord_archive_(notes|note_tallies)/i.test(String(error?.message || error))) return [];
    throw error;
  }
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
  const game = typeof body.game === "string" ? body.game.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (!validDate(date)) throw new ApiError(400, "Choose a valid gathering date.");
  if (!activity || activity.length > 120) throw new ApiError(400, "Activity must be between 1 and 120 characters.");
  if (/^war\s*dogs$/i.test(activity)) throw new ApiError(400, "Choose Video Games as the category and War Dogs as the game.");
  if (!location || location.length > 120) throw new ApiError(400, "Choose a location up to 120 characters long.");
  if (activity.toLowerCase() === "video games" && !game) throw new ApiError(400, "Choose the video game for this gathering.");
  if (game.length > 120) throw new ApiError(400, "Game must be 120 characters or fewer.");
  if (notes.length > 500) throw new ApiError(400, "Notes must be 500 characters or fewer.");
  if (!body.attendance || typeof body.attendance !== "object" || Array.isArray(body.attendance)) throw new ApiError(400, "Attendance for every active member is required.");
  const attendance = {};
  for (const id of memberIds) {
    if (typeof body.attendance[id] !== "boolean") throw new ApiError(400, "Attendance for every active member is required.");
    attendance[id] = body.attendance[id];
  }
  if (Object.keys(body.attendance).length !== memberIds.length) throw new ApiError(400, "Attendance data contains an unknown member.");
  return { date, activity, game: activity.toLowerCase() === "video games" ? game : "", location, notes, attendance };
}
