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
  assert.deepEqual(state.seasons[0].paid.a, ["2026-10-24"]);
});
