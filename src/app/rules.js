/* ───────────── 2. RULES (pure) ───────────── */
function sortSessions(list) {
  return [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
}

/* Replays a season chronologically. Returns per-member stats, per-gathering rows
   (with each member's outcome) and the running group attendance series. */
function computeSeason(season) {
  const sessions = sortSessions(season.sessions);
  const members = {};
  MEMBERS.forEach((m) => {
    members[m.id] = { id: m.id, name: m.name, initial: m.name[0], attended: 0, missed: 0, strikes: 0, earned: [], cells: [], series: [], streak: 0, best: 0, byActivity: {} };
  });
  const rows = [];
  const groupSeries = [];
  let presentTotal = 0;
  sessions.forEach((s, k) => {
    const outcomes = [];
    let present = 0;
    MEMBERS.forEach((m) => {
      const x = members[m.id];
      const here = !!s.att[m.id];
      let beer = false;
      if (here) {
        x.attended++; present++; x.streak++;
        if (x.streak > x.best) x.best = x.streak;
      } else {
        x.missed++; x.streak = 0; x.strikes++;
        if (x.strikes >= STRIKE_LIMIT) {
          x.strikes = 0; beer = true;
          x.earned.push({ sid: s.id, date: s.date, activity: s.activity });
        }
      }
      if (!x.byActivity[s.activity]) x.byActivity[s.activity] = { p: 0, t: 0 };
      x.byActivity[s.activity].t++;
      if (here) x.byActivity[s.activity].p++;
      x.cells.push({ sid: s.id, here: here, beer: beer, date: s.date, activity: s.activity });
      x.series.push(x.attended / (k + 1));
      outcomes.push({ id: m.id, name: m.name, initial: m.name[0], here: here, beer: beer, strikes: x.strikes });
    });
    presentTotal += present;
    groupSeries.push(presentTotal / (MEMBERS.length * (k + 1)));
    rows.push({ s: s, present: present, outcomes: outcomes });
  });
  return { members: members, rows: rows, count: sessions.length, groupSeries: groupSeries };
}

/* Beer ledger derived from a computed season + the season's payment list. */
function ledgerFor(season, C) {
  const out = {};
  MEMBERS.forEach((m) => {
    const earned = C.members[m.id].earned;
    const paidDates = season.paid[m.id] || [];
    const fulfilled = Math.min(paidDates.length, earned.length);
    out[m.id] = {
      earnedCount: earned.length, fulfilled: fulfilled, owed: earned.length - fulfilled,
      paidCount: paidDates.length, credit: paidDates.length - fulfilled, paidDates: paidDates
    };
  });
  return out;
}

function strikesBefore(season, date, excludeId) {
  const sessions = season.sessions.filter((x) => x.id !== excludeId && x.date <= date);
  const C = computeSeason({ sessions: sessions, paid: {} });
  const out = {};
  MEMBERS.forEach((m) => { out[m.id] = C.members[m.id].strikes; });
  return out;
}

function findDuplicate(season, form) {
  const a = form.activity.trim().toLowerCase();
  if (!a) return null;
  return season.sessions.find((x) => x.id !== form.editId && x.date === form.date && x.activity.trim().toLowerCase() === a) || null;
}

function selectedGame(form) {
  return form.gameChoice === 'Other' ? String(form.gameOther || '').trim() : String(form.gameChoice || '').trim();
}

function selectedLocation(form) {
  return form.locationChoice === 'Other' ? String(form.locationOther || '').trim() : String(form.locationChoice || '').trim();
}

function isFormComplete(form) {
  const isVideoGames = form.activity.trim().toLowerCase() === 'video games';
  return MEMBERS.every((m) => form.att[m.id] !== undefined) && !!form.date && !!form.activity.trim() && !!selectedLocation(form) && (!isVideoGames || !!selectedGame(form));
}
