/* ───────────── 4. ACTIONS (the only state transitions) ───────────── */
function currentSeason(S) { return S.seasons.find((s) => !s.closed) || S.seasons[S.seasons.length - 1]; }
function viewedSeason(S) { return S.viewId != null ? (S.seasons.find((s) => s.id === S.viewId) || currentSeason(S)) : currentSeason(S); }
function canEditNow(S) { return S.role === 'admin' && !viewedSeason(S).closed; }
function mapCurrent(S, fn) { const id = currentSeason(S).id; return S.seasons.map((s) => (s.id === id ? fn(s) : s)); }
function memberName(id) { return MEMBERS.find((m) => m.id === id).name; }

const ACTIONS = {
  nav: (S, p) => {
    if (p.view === 'record' && S.view !== 'record') return { patch: { view: 'record', menu: null, confirmDel: false, form: blankForm(S.today) } };
    return { patch: { view: p.view, menu: null, confirmDel: false } };
  },
  setRole: (S, p) => ({ patch: { role: p.role } }),
  toggleMenu: (S, p) => ({ patch: { menu: S.menu === p.menu ? null : p.menu, confirmNew: false } }),
  closeMenu: () => ({ patch: { menu: null, confirmNew: false } }),
  pickSeason: (S, p) => ({ patch: { viewId: p.id, menu: null, confirmNew: false, openId: null } }),
  askNewSeason: () => ({ patch: { confirmNew: true } }),
  cancelNewSeason: () => ({ patch: { confirmNew: false } }),
  startSeason: (S) => {
    const seasons = S.seasons.map((s) => (s.closed ? s : { ...s, closed: true }));
    const n = seasons.filter((s) => !s.imported).length + 1;
    seasons.push(emptySeason('s' + (S.nextId + 1), 'Season ' + n));
    return { patch: { seasons: seasons, nextId: S.nextId + 1, viewId: null, view: 'board', menu: null, confirmNew: false, form: blankForm(S.today) }, toast: { text: 'Season ' + n + ' started' } };
  },
  loadData: (S, p) => ({ patch: initialState(p.demo) }),
  openMember: (S, p) => ({ patch: { view: 'member', memberId: p.id, menu: null } }),
  openGathering: (S, p) => ({ patch: { view: 'history', openId: p.id, histFilter: 'all' } }),
  toggleGathering: (S, p) => ({ patch: { openId: S.openId === p.id ? null : p.id } }),
  filterHistory: (S, p) => ({ patch: { histFilter: S.histFilter === p.id ? 'all' : p.id } }),
  filterLedger: (S, p) => ({ patch: { ledgerFilter: p.key } }),

  setField: (S, p) => ({ patch: { form: { ...S.form, [p.field]: p.value } } }),
  setAttendance: (S, p) => ({ patch: { form: { ...S.form, att: { ...S.form.att, [p.id]: p.value } } } }),
  setAllAttendance: (S, p) => {
    const att = {};
    MEMBERS.forEach((m) => { att[m.id] = p.value; });
    return { patch: { form: { ...S.form, att: att } } };
  },
  startEdit: (S, p) => {
    const s = currentSeason(S).sessions.find((x) => x.id === p.id);
    if (!s) return {};
    return { patch: { view: 'record', confirmDel: false, form: { editId: s.id, date: s.date, activity: s.activity, notes: s.notes || '', att: { ...s.att } } } };
  },
  cancelEdit: (S) => ({ patch: { view: 'history', confirmDel: false, form: blankForm(S.today) } }),

  saveGathering: (S) => {
    const f = S.form;
    if (!isFormComplete(f) || findDuplicate(currentSeason(S), f)) return {};
    const id = f.editId || S.nextId + 1;
    const session = { id: id, date: f.date, activity: f.activity.trim(), notes: f.notes.trim(), att: { ...f.att } };
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
