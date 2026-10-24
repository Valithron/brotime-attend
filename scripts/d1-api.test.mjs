import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/[[path]].js";
import { ApiError } from "../functions/_lib/http.js";
import { loadAppState, validDate, validateGathering } from "../functions/_lib/db.js";

const members = ["s", "a", "j", "n", "i"].map((id) => ({ id }));
const attendance = { s: true, a: false, j: true, n: true, i: false };

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes("COUNT(*) AS count FROM seasons")) return { count: 1 };
    if (this.sql.includes("FROM seasons WHERE is_current")) return this.db.currentSeason;
    if (this.sql.includes("FROM gatherings WHERE season_id = ? AND date = ?")) return this.db.duplicate;
    return null;
  }

  async all() {
    if (this.sql.includes("FROM members WHERE is_active")) return { results: members };
    return { results: [] };
  }

  async run() {
    this.db.runs++;
    return { success: true, meta: { changes: 1 } };
  }
}

class FakeDatabase {
  constructor() {
    this.currentSeason = { id: 1, name: String(new Date().getFullYear()) };
    this.duplicate = null;
    this.runs = 0;
    this.batches = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    this.batches.push(statements.map((statement) => ({ sql: statement.sql, values: statement.values })));
    return [{ results: [{ id: 23 }], meta: { last_row_id: 23 } }];
  }
}

const env = (DB) => ({ DB });
const sameOriginHeaders = { origin: "https://brotime-attend.pages.dev" };

test("the live state can be read without a login", async () => {
  const rows = [{
    id: 23, season_id: 1, date: "2026-10-23", activity: "Video Games", game: "War Dogs",
    location: "Studio", notes: "Tournament night", member_id: "s", present: 1
  }];
  const db = {
    prepare(sql) {
      return {
        all: async () => {
          if (sql.includes("FROM seasons")) return { results: [{ id: 1, name: "2026", closed: 0, imported: 0, is_current: 1 }] };
          if (sql.includes("FROM members")) return { results: [{ id: "s", name: "Sterling" }] };
          if (sql.includes("FROM gatherings")) return { results: rows };
          return { results: [] };
        }
      };
    }
  };
  const request = new Request("https://brotime-attend.pages.dev/api/state");
  const response = await onRequest({ request, env: env(db) });
  const state = await response.json();
  assert.equal(response.status, 200);
  assert.equal(state.currentSeasonId, 1);
  assert.equal(state.seasons[0].sessions[0].activity, "Video Games");
  assert.equal(state.seasons[0].sessions[0].game, "War Dogs");
  assert.equal(state.seasons[0].sessions[0].location, "Studio");
});

test("a same-origin visitor can record a video game gathering with its location", async () => {
  const db = new FakeDatabase();
  const request = new Request("https://brotime-attend.pages.dev/api/gatherings", {
    method: "POST",
    headers: { ...sameOriginHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      date: "2026-10-23", activity: "Video Games", game: "War Dogs", location: "Studio",
      notes: "Tournament night", attendance
    })
  });
  const response = await onRequest({ request, env: env(db) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: 23, message: "Gathering saved." });
  assert.equal(db.batches.length, 1);
  assert.deepEqual(db.batches[0][0].values, [1, "2026-10-23", "Video Games", "Tournament night", "War Dogs", "Studio", null]);
  assert.equal(db.batches[0].length, 6);
});

test("public writes still reject requests from a different origin", async () => {
  const db = new FakeDatabase();
  const request = new Request("https://brotime-attend.pages.dev/api/gatherings", {
    method: "POST",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
    body: JSON.stringify({ date: "2026-10-23", activity: "Poker", location: "Studio", attendance })
  });
  const response = await onRequest({ request, env: env(db) });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "This request must come from the Brotime site." });
  assert.equal(db.batches.length, 0);
});

test("a new year uses a year label instead of a season number", async () => {
  const db = new FakeDatabase();
  const expectedYear = String(Math.max(new Date().getFullYear(), Number(db.currentSeason.name) + 1));
  const request = new Request("https://brotime-attend.pages.dev/api/seasons", { method: "POST", headers: sameOriginHeaders });
  const response = await onRequest({ request, env: env(db) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, message: expectedYear + " started." });
  assert.equal(db.batches[0][1].values[0], expectedYear);
});

test("gathering validation requires a game for Video Games and a location for every event", () => {
  const memberIds = ["s", "a", "j", "n", "i"];
  const form = {
    date: "2026-10-23", activity: "  Video Games  ", game: "  War Dogs  ", location: "  Studio  ",
    notes: "  weekly game  ", attendance
  };
  assert.equal(validDate("2026-10-23"), true);
  assert.equal(validDate("2026-02-30"), false);
  assert.deepEqual(validateGathering(form, memberIds), {
    date: "2026-10-23", activity: "Video Games", game: "War Dogs", location: "Studio",
    notes: "weekly game", attendance
  });
  assert.throws(() => validateGathering({ ...form, date: "2026-02-30" }, memberIds), (error) => error instanceof ApiError && error.status === 400);
  assert.throws(() => validateGathering({ ...form, game: "" }, memberIds), (error) => error instanceof ApiError && error.status === 400);
  assert.throws(() => validateGathering({ ...form, location: "" }, memberIds), (error) => error instanceof ApiError && error.status === 400);
  assert.throws(() => validateGathering({ ...form, activity: "War Dogs" }, memberIds), (error) => error instanceof ApiError && error.status === 400);
  assert.throws(() => validateGathering({ ...form, attendance: { s: true } }, memberIds), (error) => error instanceof ApiError && error.status === 400);
});

test("D1 state loading preserves the event's game and location", async () => {
  const currentMembers = ["s", "a", "j", "n", "i"].map((id, index) => ({ id, name: ["Sterling", "Adam", "Julian", "Nathan", "Isaiah"][index] }));
  const rows = [
    { id: 20, season_id: 1, date: "2026-10-23", activity: "Video Games", game: "War Dogs", location: "Studio", notes: "", member_id: "s", present: 1 },
    { id: 20, season_id: 1, date: "2026-10-23", activity: "Video Games", game: "War Dogs", location: "Studio", notes: "", member_id: "a", present: 0 }
  ];
  const db = {
    prepare(sql) {
      return {
        all: async () => {
          if (sql.includes("FROM seasons")) return { results: [{ id: 1, name: "2026", closed: 0, imported: 0, is_current: 1 }] };
          if (sql.includes("FROM members")) return { results: currentMembers };
          if (sql.includes("FROM gatherings")) return { results: rows };
          if (sql.includes("FROM beer_payments")) return { results: [{ season_id: 1, member_id: "a", paid_on: "2026-10-24" }] };
          return { results: [] };
        }
      };
    }
  };
  const state = await loadAppState(db);
  assert.equal(state.currentSeasonId, 1);
  assert.equal(state.seasons[0].sessions[0].att.a, false);
  assert.equal(state.seasons[0].sessions[0].att.s, true);
  assert.equal(state.seasons[0].sessions[0].game, "War Dogs");
  assert.equal(state.seasons[0].sessions[0].location, "Studio");
  assert.equal(state.seasons[0].sessions[0].attendanceComplete, false);
  assert.deepEqual(state.seasons[0].paid.a, ["2026-10-24"]);
});

test("D1 state marks a gathering incomplete when an active attendance row is missing", async () => {
  const currentMembers = ["s", "a", "j", "n", "i"].map((id) => ({ id, name: id, is_active: 1 }));
  const rows = currentMembers.slice(0, 4).map((member) => ({
    id: 21, season_id: 1, date: "2026-10-24", activity: "Poker", game: "", location: "Studio", notes: "", member_id: member.id, present: 1
  }));
  const db = {
    prepare(sql) {
      return {
        all: async () => {
          if (sql.includes("discord_record_metadata")) return { results: [] };
          if (sql.includes("discord_archive_notes")) return { results: [] };
          if (sql.includes("FROM seasons")) return { results: [{ id: 1, name: "2026", closed: 0, imported: 0, is_current: 1 }] };
          if (sql.includes("FROM members")) return { results: currentMembers };
          if (sql.includes("FROM gatherings")) return { results: rows };
          return { results: [] };
        }
      };
    }
  };
  const state = await loadAppState(db);
  assert.equal(state.seasons[0].sessions[0].attendanceComplete, false);
});

test("Discord records keep the historical six-person data separate from active members", async () => {
  const allMembers = [
    { id: "s", name: "Sterling", is_active: 1 },
    { id: "a", name: "Adam", is_active: 1 },
    { id: "j", name: "Julian", is_active: 1 },
    { id: "n", name: "Nathan", is_active: 1 },
    { id: "i", name: "Isaiah", is_active: 1 },
    { id: "john", name: "John", is_active: 0 }
  ];
  const archiveRows = [
    {
      id: 99, year: "2026", date: "2026-04-26", activity: "Board games", game: "Star Realms",
      location: "Sterling's House", event_title: "Star Realms at Sterling's house", event_label: "April 26, star realms at sterling's house",
      source_posted_at: "2026-04-26 21:27", date_confidence: "explicit", source_note: "Last tally in the pasted log.",
      member_id: "john", status: "absent", source_strikes: 3, beer_markers: ""
    },
    {
      id: 99, year: "2026", date: "2026-04-26", activity: "Board games", game: "Star Realms",
      location: "Sterling's House", event_title: "Star Realms at Sterling's house", event_label: "April 26, star realms at sterling's house",
      source_posted_at: "2026-04-26 21:27", date_confidence: "explicit", source_note: "Last tally in the pasted log.",
      member_id: "a", status: "present", source_strikes: 0, beer_markers: ""
    }
  ];
  const db = {
    prepare(sql) {
      return {
        all: async () => {
          if (sql.includes("discord_record_metadata")) return { results: archiveRows };
          if (sql.includes("discord_archive_notes")) return { results: [] };
          if (sql.includes("FROM seasons")) return { results: [
            { id: 1, name: "2026", closed: 0, imported: 0, is_current: 1 },
            { id: 2, name: "2026", closed: 1, imported: 1, is_current: 0 }
          ] };
          if (sql.includes("FROM members")) return { results: allMembers };
          if (sql.includes("FROM gatherings")) return { results: [] };
          return { results: [] };
        }
      };
    }
  };
  const state = await loadAppState(db);
  assert.deepEqual(state.members.map((member) => member.id), ["s", "a", "j", "n", "i"]);
  assert.deepEqual(state.discordMembers.map((member) => member.id), ["a", "n", "john", "j", "s", "i"]);
  assert.equal(state.discordEvents.length, 1);
  assert.equal(state.discordEvents[0].attendance.john.status, "absent");
  assert.equal(state.discordEvents[0].attendance.john.strikes, 3);
  assert.equal(state.discordEvents[0].attendance.a.status, "present");
  assert.equal(state.seasons[0].sessions.length, 0);
});

test("the live tracker still loads before the Discord import migration is run", async () => {
  const db = {
    prepare(sql) {
      return {
        all: async () => {
          if (sql.includes("discord_record_metadata")) throw new Error("no such table: discord_record_metadata");
          if (sql.includes("discord_archive_notes")) throw new Error("no such table: discord_archive_notes");
          if (sql.includes("FROM seasons")) return { results: [{ id: 1, name: "2026", closed: 0, imported: 0, is_current: 1 }] };
          if (sql.includes("FROM members")) return { results: members.map((member) => ({ ...member, is_active: 1 })) };
          return { results: [] };
        }
      };
    }
  };
  const state = await loadAppState(db);
  assert.equal(state.currentSeasonId, 1);
  assert.equal(state.discordEvents.length, 0);
  assert.equal(state.members.length, 5);
});

test('the lightweight startup request excludes imported gatherings and archive queries', async () => {
  const queries = [];
  const db = { prepare(sql) { queries.push(sql); return { all: async () => ({ results: sql.includes('FROM seasons') && !sql.includes('FROM gatherings') ? [{ id: 1, name: '2026', closed: 0, imported: 0, is_current: 1 }] : [] }) }; } };
  const response = await onRequest({ request: new Request('https://brotime-attend.pages.dev/api/state?scope=live'), env: env(db) });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.currentSeasonId, 1);
  assert.deepEqual(data.discordEvents, []);
  assert.equal(queries.some(sql => sql.includes('discord_record_metadata')), false);
  assert.equal(queries.some(sql => sql.includes('discord_archive_notes')), false);
  assert.ok(queries.some(sql => sql.includes('WHERE imported = 0')));
});
