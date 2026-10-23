/* ───────────── 3. DATA (seed + factories) ───────────── */
function emptyPaid() { const p = {}; MEMBERS.forEach((m) => { p[m.id] = []; }); return p; }
function emptySeason(id, name) { return { id: id, name: name, closed: false, imported: false, sessions: [], paid: emptyPaid() }; }
function isoToday() {
  const d = new Date();
  const p = (x) => (x < 10 ? '0' + x : '' + x);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function blankForm(today) { return { editId: null, date: today, activity: '', gameChoice: '', gameOther: '', locationChoice: '', locationOther: '', notes: '', att: {} }; }

function makeSessions(start, masks, activities, firstId, notes) {
  return masks.map((mask, k) => {
    const att = {};
    MEMBERS.forEach((m, x) => { att[m.id] = mask[x] === '1'; });
    const activity = activities[k % activities.length];
    return {
      id: firstId + k,
      date: new Date(Date.UTC(start[0], start[1], start[2] + 7 * k)).toISOString().slice(0, 10),
      activity: activity, game: activity === 'Video Games' ? 'War Dogs' : '', location: 'Studio', notes: notes[k] || '', att: att
    };
  });
}

/* mask digit order = MEMBERS order: Sterling, Adam, Julian, Nathan, Isaiah. 1 = present */
function demoSeasons() {
  const archive = emptySeason('arc', '2024');
  archive.closed = true; archive.imported = true;
  archive.sessions = makeSessions([2024, 8, 8],
    ['11111', '10111', '11011', '11101', '01111', '11110', '10110', '11111', '11011', '01101'],
    ['Video Games', 'Poker', 'Board games', 'Disc golf'], 1001, {});
  const current = emptySeason('cur', String(new Date().getFullYear()));
  current.sessions = makeSessions([2026, 5, 21],
    ['11111', '11011', '10110', '11101', '01111', '11111', '10011', '11110', '01101', '11011',
     '00111', '10111', '10111', '11001', '01110', '11011', '11110', '01111'],
    ['Video Games', 'Poker', 'Disc golf', 'Board games', 'Movie night', 'Video Games'], 1,
    { 2: 'Rain delay, played inside', 10: 'Tournament night', 17: 'First snow' });
  current.paid.j = ['2026-10-04'];
  return [archive, current];
}

function initialState(demo) {
  const today = isoToday();
  return {
    seasons: demo ? demoSeasons() : [emptySeason('cur', String(new Date().getFullYear()))],
    discordMembers: [], discordEvents: [], discordNotes: [],
    viewId: null, view: 'board', memberId: 's',
    histFilter: 'all', historyMode: 'live', ledgerFilter: 'owed', openId: null, menu: null,
    confirmNew: false, confirmDel: false, toast: null,
    form: blankForm(today), nextId: 5000, today: today
  };
}
