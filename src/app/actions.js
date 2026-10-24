/* ───────────── 4. ACTIONS (the only state transitions) ───────────── */
function currentSeason(S) { return S.seasons.find((s) => !s.closed) || S.seasons[S.seasons.length - 1]; }
function viewedSeason(S) { return S.viewId != null ? (S.seasons.find((s) => s.id === S.viewId) || currentSeason(S)) : currentSeason(S); }
function canEditNow(S) { return !viewedSeason(S).closed; }
function mapCurrent(S, fn) { const id = currentSeason(S).id; return S.seasons.map((s) => (s.id === id ? fn(s) : s)); }
function memberName(id) { return MEMBERS.find((m) => m.id === id).name; }

const ACTIONS = {
  nav: (S, p) => {
    if (p.view === 'record' && S.view !== 'record') return { patch: { view: 'record', menu: null, confirmDel: false, form: blankForm(S.today) } };
    return { patch: { view: p.view, menu: null, confirmDel: false } };
  },
  toggleMenu: (S, p) => ({ patch: { menu: S.menu === p.menu ? null : p.menu, confirmNew: false } }),
  closeMenu: () => ({ patch: { menu: null, confirmNew: false } }),
  pickSeason: (S, p) => ({ patch: { viewId: p.id, menu: null, confirmNew: false, openId: null } }),
  askNewSeason: () => ({ patch: { confirmNew: true } }),
  cancelNewSeason: () => ({ patch: { confirmNew: false } }),
  startSeason: (S) => {
    const seasons = S.seasons.map((s) => (s.closed ? s : { ...s, closed: true }));
    const activeYear = Number(currentSeason(S).name);
    const year = String(Math.max(new Date().getFullYear(), Number.isInteger(activeYear) ? activeYear + 1 : new Date().getFullYear()));
    seasons.push(emptySeason('s' + (S.nextId + 1), year));
    return { patch: { seasons: seasons, nextId: S.nextId + 1, viewId: null, view: 'board', menu: null, confirmNew: false, form: blankForm(S.today) }, toast: { text: year + ' started' } };
  },
  openMember: (S, p) => ({ patch: { view: 'member', memberId: p.id, menu: null } }),
  openGathering: (S, p) => ({ patch: { view: 'history', openId: p.id, histFilter: 'all' } }),
  toggleGathering: (S, p) => ({ patch: { openId: S.openId === p.id ? null : p.id } }),
  toggleDiscordRecord: (S, p) => ({ patch: { openId: S.openId === p.id ? null : p.id } }),
  filterHistory: (S, p) => ({ patch: { histFilter: S.histFilter === p.id ? 'all' : p.id } }),
  setHistoryMode: (S, p) => ({ patch: { historyMode: p.mode, histFilter: 'all', openId: null } }),
  filterLedger: (S, p) => ({ patch: { ledgerFilter: p.key } }),

  setField: (S, p) => {
    if (p.field === 'activity' && /^war\s*dogs$/i.test(String(p.value).trim())) {
      return { patch: { form: { ...S.form, activity: 'Video Games', gameChoice: 'War Dogs' } } };
    }
    return { patch: { form: { ...S.form, [p.field]: p.value } } };
  },
  setAttendance: (S, p) => ({ patch: { form: { ...S.form, att: { ...S.form.att, [p.id]: p.value } } } }),
  setAllAttendance: (S, p) => {
    const att = {};
    MEMBERS.forEach((m) => { att[m.id] = p.value; });
    return { patch: { form: { ...S.form, att: att } } };
  },
  startEdit: (S, p) => {
    const s = currentSeason(S).sessions.find((x) => x.id === p.id);
    if (!s) return {};
    const gameIsPreset = GAME_OPTIONS.includes(s.game) && s.game !== 'Other';
    const locationIsPreset = LOCATION_OPTIONS.includes(s.location) && s.location !== 'Other';
    return { patch: { view: 'record', confirmDel: false, form: {
      editId: s.id, date: s.date, activity: s.activity,
      gameChoice: s.game ? (gameIsPreset ? s.game : 'Other') : '', gameOther: s.game && !gameIsPreset ? s.game : '',
      locationChoice: s.location ? (locationIsPreset ? s.location : 'Other') : '', locationOther: s.location && !locationIsPreset ? s.location : '',
      notes: s.notes || '', att: { ...s.att }
    } } };
  },
  cancelEdit: (S) => ({ patch: { view: 'history', confirmDel: false, form: blankForm(S.today) } }),

  saveGathering: (S) => {
    const f = S.form;
    if (!isFormComplete(f) || findDuplicate(currentSeason(S), f)) return {};
    const id = f.editId || S.nextId + 1;
    const activity = f.activity.trim();
    const session = { id: id, date: f.date, activity: activity, game: activity.toLowerCase() === 'video games' ? selectedGame(f) : '', location: selectedLocation(f), notes: f.notes.trim(), att: { ...f.att }, attendanceComplete: true };
    const seasons = mapCurrent(S, (s) => ({ ...s, sessions: f.editId ? s.sessions.map((x) => (x.id === id ? session : x)) : [...s.sessions, session] }));
    const C = computeSeason(seasons.find((s) => !s.closed));
    const row = C.rows.find((r) => r.s.id === id);
    const beers = row ? row.outcomes.filter((o) => o.beer).map((o) => o.name) : [];
    const text = beers.length ? beers.join(', ') + (beers.length > 1 ? ' each earned a beer' : ' earned a beer') : (f.editId ? 'Changes saved' : 'Gathering saved');
    return {
      patch: { seasons: seasons, nextId: f.editId ? S.nextId : S.nextId + 1, view: 'history', openId: id, histFilter: 'all', confirmDel: false, form: blankForm(S.today) },
      toast: { text: text, pint: beers.length > 0 }
    };
  },
  deleteGathering: (S) => {
    if (!S.confirmDel) return { patch: { confirmDel: true } };
    const id = S.form.editId;
    const seasons = mapCurrent(S, (s) => ({ ...s, sessions: s.sessions.filter((x) => x.id !== id) }));
    return { patch: { seasons: seasons, view: 'history', openId: null, confirmDel: false, form: blankForm(S.today) }, toast: { text: 'Gathering deleted' } };
  },

  settleBeer: (S, p) => ({
    patch: { seasons: mapCurrent(S, (s) => ({ ...s, paid: { ...s.paid, [p.id]: [...(s.paid[p.id] || []), S.today] } })) },
    toast: { text: memberName(p.id) + ' settled a beer' }
  }),
  undoBeer: (S, p) => ({
    patch: { seasons: mapCurrent(S, (s) => ({ ...s, paid: { ...s.paid, [p.id]: (s.paid[p.id] || []).slice(0, -1) } })) },
    toast: { text: 'Payment reversed for ' + memberName(p.id) }
  })
};
