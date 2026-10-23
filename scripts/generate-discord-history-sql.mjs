import { readFile, writeFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("./discord-history.json", import.meta.url), "utf8"));
const sql = [];
const q = (value) => value == null ? "NULL" : (typeof value === "number" ? String(value) : "'" + String(value).replaceAll("'", "''") + "'");
const values = (rows) => rows.map((row) => "(" + row.map(q).join(",") + ")").join(",\n");

sql.push(
  "CREATE TABLE IF NOT EXISTS discord_record_metadata (",
  "  gathering_id INTEGER PRIMARY KEY REFERENCES gatherings(id) ON DELETE CASCADE,",
  "  event_title TEXT NOT NULL,",
  "  event_label TEXT NOT NULL DEFAULT '',",
  "  source_posted_at TEXT,",
  "  date_confidence TEXT NOT NULL,",
  "  source_note TEXT NOT NULL DEFAULT ''",
  ");",
  "CREATE TABLE IF NOT EXISTS discord_attendance (",
  "  gathering_id INTEGER NOT NULL REFERENCES gatherings(id) ON DELETE CASCADE,",
  "  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,",
  "  status TEXT NOT NULL CHECK (status IN ('present','absent','unknown')),",
  "  source_strikes INTEGER CHECK (source_strikes IS NULL OR source_strikes BETWEEN 0 AND 5),",
  "  beer_markers TEXT NOT NULL DEFAULT '',",
  "  PRIMARY KEY (gathering_id, member_id)",
  ");",
  "CREATE TABLE IF NOT EXISTS discord_archive_notes (",
  "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
  "  note_date TEXT NOT NULL,",
  "  note_type TEXT NOT NULL,",
  "  body TEXT NOT NULL,",
  "  source_posted_at TEXT,",
  "  UNIQUE (note_date, note_type, body)",
  ");",
  "CREATE TABLE IF NOT EXISTS discord_archive_note_tallies (",
  "  note_id INTEGER NOT NULL REFERENCES discord_archive_notes(id) ON DELETE CASCADE,",
  "  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,",
  "  source_strikes INTEGER NOT NULL CHECK (source_strikes BETWEEN 0 AND 5),",
  "  beer_markers TEXT NOT NULL DEFAULT '',",
  "  PRIMARY KEY (note_id, member_id)",
  ");",
  "INSERT OR IGNORE INTO members (id, name, sort_order, is_active) VALUES ('john', 'John', 6, 0);",
  "INSERT INTO seasons (name, closed, imported, is_current) SELECT '2024', 1, 1, 0 WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE name = '2024' AND imported = 1);",
  "INSERT INTO seasons (name, closed, imported, is_current) SELECT '2025', 1, 1, 0 WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE name = '2025' AND imported = 1);",
  "INSERT INTO seasons (name, closed, imported, is_current) SELECT '2026', 1, 1, 0 WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE name = '2026' AND imported = 1);"
);

const eventRows = data.events.map((event) => [
  event.date.slice(0, 4), event.date, event.activity, event.sourceNote, event.game, event.location
]);
sql.push(
  "WITH records(year, event_date, activity, notes, game, location) AS (VALUES\n" + values(eventRows) + "\n)\n" +
  "INSERT OR IGNORE INTO gatherings (season_id, date, activity, notes, game, location, created_by_discord_id)\n" +
  "SELECT s.id, r.event_date, r.activity, r.notes, r.game, r.location, NULL\n" +
  "FROM records r JOIN (SELECT name, MIN(id) AS id FROM seasons WHERE imported = 1 GROUP BY name) s ON s.name = r.year;"
);

const metadataRows = data.events.map((event) => [
  event.date.slice(0, 4), event.date, event.activity, event.title, event.eventLabel,
  event.sourcePostedAt || null, event.dateConfidence, event.sourceNote
]);
sql.push(
  "WITH records(year, event_date, activity, event_title, event_label, source_posted_at, date_confidence, source_note) AS (VALUES\n" + values(metadataRows) + "\n)\n" +
  "INSERT OR REPLACE INTO discord_record_metadata (gathering_id, event_title, event_label, source_posted_at, date_confidence, source_note)\n" +
  "SELECT g.id, r.event_title, r.event_label, r.source_posted_at, r.date_confidence, r.source_note\n" +
  "FROM records r JOIN (SELECT name, MIN(id) AS id FROM seasons WHERE imported = 1 GROUP BY name) s ON s.name = r.year\n" +
  "JOIN gatherings g ON g.season_id = s.id AND g.date = r.event_date AND g.activity = r.activity COLLATE NOCASE;"
);

const attendanceRows = data.events.flatMap((event) => Object.entries(event.attendance).map(([memberId, attendance]) => [
  event.date.slice(0, 4), event.date, event.activity, memberId, attendance.status, attendance.strikes, attendance.beerMarkers
]));
sql.push(
  "WITH records(year, event_date, activity, member_id, status, source_strikes, beer_markers) AS (VALUES\n" + values(attendanceRows) + "\n)\n" +
  "INSERT OR REPLACE INTO discord_attendance (gathering_id, member_id, status, source_strikes, beer_markers)\n" +
  "SELECT g.id, r.member_id, r.status, r.source_strikes, r.beer_markers\n" +
  "FROM records r JOIN (SELECT name, MIN(id) AS id FROM seasons WHERE imported = 1 GROUP BY name) s ON s.name = r.year\n" +
  "JOIN gatherings g ON g.season_id = s.id AND g.date = r.event_date AND g.activity = r.activity COLLATE NOCASE;"
);

const knownAttendanceRows = attendanceRows.filter((row) => row[4] !== "unknown").map((row) => [
  row[0], row[1], row[2], row[3], row[4] === "present" ? 1 : 0
]);
sql.push(
  "WITH records(year, event_date, activity, member_id, present) AS (VALUES\n" + values(knownAttendanceRows) + "\n)\n" +
  "INSERT OR REPLACE INTO attendance (gathering_id, member_id, present, recorded_by_discord_id)\n" +
  "SELECT g.id, r.member_id, r.present, NULL\n" +
  "FROM records r JOIN (SELECT name, MIN(id) AS id FROM seasons WHERE imported = 1 GROUP BY name) s ON s.name = r.year\n" +
  "JOIN gatherings g ON g.season_id = s.id AND g.date = r.event_date AND g.activity = r.activity COLLATE NOCASE;"
);

const noteRows = data.notes.map((note) => [note.date, note.type, note.text, note.sourcePostedAt || null]);
sql.push(
  "INSERT OR IGNORE INTO discord_archive_notes (note_date, note_type, body, source_posted_at) VALUES\n" + values(noteRows) + ";"
);
const baselineNote = data.notes.find((note) => note.type === "baseline");
const tallyRows = Object.entries(baselineNote.tallies).map(([memberId, tally]) => [
  baselineNote.date, baselineNote.type, baselineNote.text, memberId, tally.strikes, tally.beerMarkers
]);
sql.push(
  "WITH records(note_date, note_type, body, member_id, source_strikes, beer_markers) AS (VALUES\n" + values(tallyRows) + "\n)\n" +
  "INSERT OR REPLACE INTO discord_archive_note_tallies (note_id, member_id, source_strikes, beer_markers)\n" +
  "SELECT n.id, r.member_id, r.source_strikes, r.beer_markers\n" +
  "FROM records r JOIN discord_archive_notes n ON n.note_date = r.note_date AND n.note_type = r.note_type AND n.body = r.body;"
);

await writeFile(new URL("../migrations/0003_discord_history.sql", import.meta.url), sql.join("\n") + "\n");
process.stdout.write(`Generated ${data.events.length} gatherings and ${attendanceRows.length} per-member source records.\n`);
