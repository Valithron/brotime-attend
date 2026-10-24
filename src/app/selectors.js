/* ───────────── 5. SELECTORS (pure view-models) ───────────── */
function fmtDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return {
    wd: d.toLocaleDateString('en-US', { weekday: 'long' }), d: d.getDate(),
    mo: d.toLocaleDateString('en-US', { month: 'short' }),
    month: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    when: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  };
}
function pipsFor(strikes, hit) { return [0, 1, 2, 3, 4].map((i) => ({ cls: hit ? 'hit' : (i < strikes ? 'on' : '') })); }
/* vertical offset of the liquid for n strikes (0 = empty, hidden below the glass) */
function liquidShift(n) { return n <= 0 ? GLASS_INNER + 12 : Math.round((1 - Math.min(n, STRIKE_LIMIT) / STRIKE_LIMIT) * (GLASS_INNER - 8)); }
function liquidClass(strikes) { return strikes === STRIKE_LIMIT - 1 ? 'hot' : ''; }
/* one cell vocabulary everywhere: here | gone (empty seat) | beer */
function cellCls(c) { return c.here ? 'here' : (c.beer ? 'beer' : 'gone'); }
function outcomeText(c) { return c.here ? 'present' : (c.beer ? 'absent, beer earned' : 'absent'); }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

const SHARE_URL = 'https://brotime719.com/';
const SHARE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Share dates are date-only values. Format the stored parts directly so the
   recap never crosses a day boundary because of a timezone conversion. */
function shareDate(iso) {
  const parts = String(iso || '').split('-');
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (parts.length !== 3 || !parts[0] || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return '';
  return SHARE_MONTHS[month - 1] + ' ' + day + ', ' + parts[0];
}

function shareMembers() { return [...MEMBERS].sort((a, b) => a.name.localeCompare(b.name)); }

function shareAttendanceComplete(session) {
  if (!session || session.attendanceComplete === false) return false;
  return MEMBERS.every((member) => session.att && typeof session.att[member.id] === 'boolean');
}

function shareNames(session, present) {
  const attendance = session && session.att ? session.att : {};
  return shareMembers().filter((member) => typeof attendance[member.id] === 'boolean' && attendance[member.id] === present).map((member) => member.name);
}

function shareMug(session) {
  const present = shareNames(session, true);
  const blankRows = MEMBERS.length - present.length;
  const edges = ['├─╮', '│ │', '├─╯', '│', '│'];
  const rows = edges.map((edge, index) => {
    const name = index < blankRows ? '' : present[index - blankRows];
    const interior = name ? (' ' + name).slice(0, 10).padEnd(10, ' ') : '          ';
    return '│' + interior + edge;
  });
  return ['╭──────────╮', ...rows, '╰──────────╯ ' + present.length + '/' + MEMBERS.length].join('\n');
}

function shareMessage(session) {
  const activity = String(session.activity || '').trim();
  const game = String(session.game || '').trim();
  const location = String(session.location || '').trim();
  const metadata = [activity, game, location].filter(Boolean).join(' · ');
  const absent = shareNames(session, false);
  const lines = ['BroTime · ' + shareDate(session.date)];
  if (metadata) lines.push(metadata);
  lines.push('', '```', shareMug(session), '```', '');
  if (absent.length) lines.push('Out: ' + absent.join(', '), '');
  lines.push(SHARE_URL);
  return lines.join('\n');
}

function buildShareContext(S, season) {
  /* A future row is a scheduled gathering until all five active attendance
     values are recorded. Ignore that unrecorded row, but keep a future row
     that already has complete results eligible as the latest saved record. */
  const sessions = sortSessions(season.sessions).filter((session) => !S.today || session.date <= S.today || shareAttendanceComplete(session));
  const session = sessions.length ? sessions[sessions.length - 1] : null;
  const complete = shareAttendanceComplete(session);
  const saved = S.share || {};
  const sameGathering = !!session && saved.id === session.id;
  const status = sameGathering ? (saved.status || 'idle') : 'idle';
  return {
    session: session,
    id: session ? session.id : null,
    hasGathering: !!session,
    complete: complete,
    blocked: !!session && !complete,
    date: session ? shareDate(session.date) : '',
    message: complete ? shareMessage(session) : '',
    status: status,
    text: sameGathering ? (saved.text || '') : '',
    error: sameGathering ? (saved.error || '') : '',
    buttonLabel: status === 'copied' ? 'Copied' : 'Copy weekly recap',
    disabled: !complete,
    fallbackVisible: status === 'fallback' && !!saved.text,
    blockedText: session ? 'Complete attendance for ' + shareDate(session.date) + ' before sharing.' : '',
    aria: complete ? 'Copy weekly recap for ' + shareDate(session.date) : (session ? 'Complete attendance for ' + shareDate(session.date) + ' before sharing' : 'No completed gathering to share')
  };
}

function buildContext(S) {
  const season = viewedSeason(S);
  const C = computeSeason(season);
  const L = ledgerFor(season, C);
  const canEdit = canEditNow(S);
  const view = (S.view === 'record' && !canEdit) ? 'board' : S.view;
  const share = buildShareContext(S, season);
  const mem = MEMBERS.map((m) => {
    const x = C.members[m.id];
    const l = L[m.id];
    const pct = C.count ? Math.round(x.attended * 100 / C.count) : null;
    const pints = [];
    for (let i = 0; i < l.owed; i++) pints.push({ cls: 'owed' });
    for (let i = 0; i < l.fulfilled; i++) pints.push({ cls: 'paid' });
    return { ...x, ...l, pct: pct, pctText: pct == null ? '–' : pct + '%', pints: pints, strikeLabel: x.strikes + ' of ' + STRIKE_LIMIT + ' strikes' };
  });
  const totals = {
    earned: mem.reduce((a, m) => a + m.earned.length, 0),
    fulfilled: mem.reduce((a, m) => a + m.fulfilled, 0)
  };
  totals.owed = totals.earned - totals.fulfilled;
  return { S: S, season: season, C: C, L: L, canEdit: canEdit, view: view, mem: mem, totals: totals, share: share };
}

function sessionRow(ctx, bind, r) {
  const d = fmtDate(r.s.date);
  const open = ctx.S.openId === r.s.id;
  const anyBeer = r.outcomes.some((o) => o.beer);
  const allHere = r.present === MEMBERS.length;
  const away = r.outcomes.filter((o) => !o.here).map((o) => o.name + (o.beer ? ' (beer earned)' : ''));
  const eventMeta = [r.s.activity.toLowerCase() === 'video games' ? r.s.game : '', r.s.location].filter(Boolean).join(' · ');
  return {
    isRow: true, isHead: false, label: '', id: r.s.id, wd: d.wd, d: d.d, mo: d.mo, when: d.when,
    activity: r.s.activity, eventMeta: eventMeta, hasEventMeta: !!eventMeta, location: r.s.location || '',
    notes: r.s.notes, hasNotes: !!r.s.notes, allHere: allHere,
    open: open, canEdit: ctx.canEdit, rowCls: open ? 'open' : '', dotCls: anyBeer ? 'beer' : (allHere ? 'full' : ''),
    aria: r.s.activity + (eventMeta ? ', ' + eventMeta : '') + ', ' + d.wd + ' ' + d.when + ', ' + (allHere ? 'everyone present' : 'absent: ' + away.join(', ')),
    chips: r.outcomes.map((o) => ({ initial: o.initial, cls: cellCls(o), tip: o.name + ' ' + outcomeText(o) })),
    effects: r.outcomes.filter((o) => !o.here).map((o) => ({
      id: o.id, name: o.name, beer: o.beer, pips: pipsFor(o.strikes, o.beer),
      aria: o.name + (o.beer ? ' reached ' + STRIKE_LIMIT + ' strikes and earned a beer' : ' now at ' + o.strikes + ' of ' + STRIKE_LIMIT + ' strikes')
    })),
    toggle: bind('toggleGathering', { id: r.s.id }), edit: bind('startEdit', { id: r.s.id }), openBoard: bind('openGathering', { id: r.s.id })
  };
}

/* Plain-JSON summary of what the screen means. Used by window.tribunal for agents. */
function snapshotOf(ctx) {
  return {
    view: ctx.view, role: 'public', canEdit: ctx.canEdit,
    season: { id: ctx.season.id, name: ctx.season.name, closed: !!ctx.season.closed, gatherings: ctx.C.count },
    totals: { ...ctx.totals },
    members: ctx.mem.map((m) => ({
      id: m.id, name: m.name, strikes: m.strikes, strikeLimit: STRIKE_LIMIT, attended: m.attended, missed: m.missed,
      pct: m.pct, owed: m.owed, settled: m.fulfilled, credit: m.credit, streak: m.streak, best: m.best
    }))
  };
}

const SELECTORS = {
  shell(ctx, bind) {
    const S = ctx.S;
    const keys = [
      { key: 'board', label: 'Board', icon: 'i-board' },
      { key: 'member', label: 'Members', icon: 'i-members' },
      ...(ctx.canEdit ? [{ key: 'record', label: 'Record', icon: 'i-plus', cta: true }] : []),
      { key: 'ledger', label: 'Ledger', icon: 'i-ledger', badge: ctx.totals.owed },
      { key: 'history', label: 'History', icon: 'i-history' }
    ];
    const tabs = keys.map((t) => ({
      key: t.key, label: t.label, icon: t.icon,
      aria: t.badge ? t.label + ', ' + plural(t.badge, 'beer', 'beers') + ' owed' : t.label,
      cls: (ctx.view === t.key ? 'on ' : '') + (t.cta ? 'cta' : ''), current: ctx.view === t.key ? 'page' : 'false',
      hasBadge: !!t.badge, badge: t.badge || 0, go: bind('nav', { view: t.key })
    }));
    const seasonList = [...S.seasons].filter((s) => !s.imported).reverse().map((s) => ({
      key: s.id, name: s.name, count: s.sessions.length,
      aria: s.name + ', ' + plural(s.sessions.length, 'gathering', 'gatherings') + (s.closed ? ', archived' : ''),
      cls: ctx.season.id === s.id ? 'on' : '',
      pick: bind('pickSeason', { id: s.closed ? s.id : null })
    }));
    return {
      viewKey: ctx.view, roleKey: 'public', seasonKey: ctx.season.id,
      seasonName: ctx.season.name, viewingClosed: !!ctx.season.closed, seasonCount: ctx.C.count,
      seasonIcon: ctx.season.closed ? 'i-lock' : 'i-cal',
      seasonAria: 'Year: ' + ctx.season.name + ', ' + plural(ctx.C.count, 'gathering', 'gatherings') + (ctx.season.closed ? ', archived' : ''),
      menuOpen: S.menu !== null, seasonMenuOpen: S.menu === 'season', optionsMenuOpen: S.menu === 'options',
      closeMenu: bind('closeMenu'),
      toggleSeasonMenu: bind('toggleMenu', { menu: 'season' }),
      toggleOptionsMenu: bind('toggleMenu', { menu: 'options' }),
      seasonList: seasonList, canStartSeason: true,
      confirmNew: S.confirmNew, confirmNewOff: !S.confirmNew,
      askNew: bind('askNewSeason'), cancelNew: bind('cancelNewSeason'), startSeason: bind('startSeason'),
      tabs: tabs,
      isBoard: ctx.view === 'board', isRecord: ctx.view === 'record', isLedger: ctx.view === 'ledger',
      isHistory: ctx.view === 'history', isMember: ctx.view === 'member',
      canEdit: ctx.canEdit, goRecord: bind('nav', { view: 'record' }),
      hasToast: !!S.toast, toastText: S.toast ? S.toast.text : '', toastPint: !!(S.toast && S.toast.pint)
    };
  },

  board(ctx, bind) {
    const C = ctx.C;
    const ranked = [...ctx.mem].sort((a, b) => ((b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct)) || (a.strikes - b.strikes) || a.name.localeCompare(b.name));
    let rank = 0; let last = -2;
    const seats = ranked.map((m, i) => {
      const p = m.pct == null ? -1 : m.pct;
      if (p !== last) { rank = i + 1; last = p; }
      const owedText = m.owed ? ', ' + plural(m.owed, 'beer', 'beers') + ' owed' : '';
      const paidText = m.fulfilled ? ', ' + m.fulfilled + ' settled' : '';
      return {
        id: m.id, name: m.name, pctText: m.pctText, strikes: m.strikes, owed: m.owed, pints: m.pints, strikeLabel: m.strikeLabel,
        rank: C.count ? rank : '', cls: m.strikes === STRIKE_LIMIT - 1 ? 'hot' : '',
        shift: liquidShift(m.strikes), liqCls: liquidClass(m.strikes),
        aria: (C.count ? 'Rank ' + rank + ', ' : '') + m.name + ', ' + m.pctText + ' attendance, ' + m.strikeLabel + owedText + paidText,
        open: bind('openMember', { id: m.id })
      };
    });
    const visible = C.rows.slice(-24);
    let prevMonth = '';
    const cols = visible.map((r) => {
      const d = fmtDate(r.s.date);
      const mo = d.mo !== prevMonth ? d.mo : '';
      prevMonth = d.mo;
      return { id: r.s.id, d: d.d, mo: mo, n: r.present, fullCls: r.present === MEMBERS.length ? 'full' : '', tip: d.when + ' · ' + r.s.activity + ' · ' + r.present + ' of ' + MEMBERS.length + ' present', go: bind('openGathering', { id: r.s.id }) };
    });
    const rows = ctx.mem.map((m) => ({
      id: m.id, name: m.name, initial: m.initial, open: bind('openMember', { id: m.id }),
      cells: m.cells.slice(-24).map((c) => ({
        sid: c.sid, cls: cellCls(c), isGone: !c.here && !c.beer, isBeer: c.beer,
        tip: m.name + ' · ' + fmtDate(c.date).when + ' · ' + c.activity + ' · ' + outcomeText(c),
        go: bind('openGathering', { id: c.sid })
      }))
    }));
    return {
      seats: seats, matrix: { cols: cols, rows: rows },
      recent: [...C.rows].reverse().slice(0, 5).map((r) => sessionRow(ctx, bind, r)),
      hasSessions: C.count > 0, noSessions: C.count === 0,
      hasShareGathering: ctx.share.hasGathering,
      shareDate: ctx.share.date,
      shareDisabled: ctx.share.disabled,
      shareBlocked: ctx.share.blocked,
      shareBlockedText: ctx.share.blockedText,
      shareButtonLabel: ctx.share.buttonLabel,
      shareFallbackVisible: ctx.share.fallbackVisible,
      shareFallbackText: ctx.share.text,
      shareFallbackError: ctx.share.error,
      shareAria: ctx.share.aria,
      copyWeeklyRecap: bind('copyWeeklyRecap'),
      selectShareFallback: bind('selectShareFallback')
    };
  },

  record(ctx, bind) {
    const S = ctx.S;
    const f = S.form;
    const base = strikesBefore(ctx.season, f.date, f.editId);
    const roll = MEMBERS.map((m) => {
      const v = f.att[m.id];
      const from = base[m.id];
      const absent = v === false;
      const hit = absent && from === STRIKE_LIMIT - 1;
      const state = v === undefined ? 'unset' : (v ? 'present' : 'absent');
      return {
        id: m.id, name: m.name, absent: absent, hit: hit, from: from, to: hit ? 0 : from + 1, state: state,
        cls: v === undefined ? '' : (v ? 'p' : (hit ? 'a x' : 'a')),
        isP: v === true, isA: v === false,
        presentCls: v === true ? 'on-p' : '', absentCls: v === false ? 'on-a' : '',
        shift: liquidShift(from), nextShift: liquidShift(absent ? (hit ? STRIKE_LIMIT : from + 1) : from),
        liqCls: hit ? 'hit' : liquidClass(from), glassCls: hit ? 'over' : '',
        glassLabel: m.name + ' at ' + from + ' of ' + STRIKE_LIMIT + ' strikes' + (absent ? (hit ? '; this absence earns a beer' : '; this absence makes ' + (from + 1)) : ''),
        setP: bind('setAttendance', { id: m.id, value: true }), setA: bind('setAttendance', { id: m.id, value: false })
      };
    });
    const names = DEFAULT_ACTIVITIES.slice();
    S.seasons.forEach((s) => s.sessions.forEach((x) => { if (names.indexOf(x.activity) < 0) names.push(x.activity); }));
    const dupS = findDuplicate(ctx.season, f);
    const tally = { p: 0, a: 0, u: 0 };
    MEMBERS.forEach((m) => { const v = f.att[m.id]; if (v === true) tally.p++; else if (v === false) tally.a++; else tally.u++; });
    const isEditing = !!f.editId;
    const activityKey = f.activity.trim().toLowerCase();
    const isVideoGames = activityKey === 'video games';
    return {
      form: f, isEditing: isEditing, recTitle: isEditing ? 'Edit gathering' : 'New gathering',
      isVideoGames: isVideoGames, isGameOther: isVideoGames && f.gameChoice === 'Other', isLocationOther: f.locationChoice === 'Other',
      cancelEdit: bind('cancelEdit'),
      actChips: names.map((a) => {
        const on = activityKey === a.toLowerCase();
        return { name: a, on: on, cls: on ? 'on' : '', pick: bind('setField', { field: 'activity', value: a }) };
      }),
      dup: !!dupS, dupText: dupS ? 'Already recorded for ' + fmtDate(dupS.date).when : '',
      openDup: dupS ? bind('startEdit', { id: dupS.id }) : bind('closeMenu'),
      allPresent: bind('setAllAttendance', { value: true }), allAbsent: bind('setAllAttendance', { value: false }),
      roll: roll, tally: tally, tallyLabel: tally.p + ' present, ' + tally.a + ' absent, ' + tally.u + ' not set',
      marks: roll.map((r) => ({
        initial: r.name[0], cls: r.state === 'present' ? 'here' : (r.hit ? 'beer' : (r.absent ? 'gone' : '')),
        tip: r.name + ': ' + (r.state === 'unset' ? 'not set' : (r.hit ? 'absent, beer earned' : r.state))
      })),
      cantSave: !(isFormComplete(f) && !dupS),
      saveLabel: isEditing ? 'Save changes' : 'Save',
      confirmDel: !!S.confirmDel, delCls: S.confirmDel ? 'arm' : '', delLabel: S.confirmDel ? 'Confirm delete' : 'Delete',
      delClick: bind('deleteGathering'), save: bind('saveGathering')
    };
  },

  ledger(ctx, bind) {
    const S = ctx.S;
    const lf = S.ledgerFilter;
    const t = ctx.totals;
    const log = [];
    ctx.mem.forEach((m) => {
      m.earned.forEach((o, i) => {
        const isPaid = i < m.fulfilled;
        const when = fmtDate(o.date).when;
        const paidDate = isPaid ? fmtDate(m.paidDates[i]).when : '';
        log.push({
          id: m.id, initial: m.initial, name: m.name, date: o.date, when: when, activity: o.activity,
          isPaid: isPaid, status: isPaid ? 'Paid' : 'Owed', cls: isPaid ? 'paid' : 'owed',
          aria: m.name + ', beer earned ' + when + ' at ' + o.activity + (isPaid ? ', settled ' + paidDate : ', owed'),
          paidOn: isPaid, paidDate: paidDate,
          canSettle: ctx.canEdit && i === m.fulfilled,
          canUndo: ctx.canEdit && isPaid && i === m.fulfilled - 1 && m.paidCount === m.fulfilled,
          settle: bind('settleBeer', { id: m.id }), undo: bind('undoBeer', { id: m.id })
        });
      });
    });
    log.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const shown = log.filter((o) => lf === 'all' || (lf === 'owed' ? !o.isPaid : o.isPaid));
    const rail = [];
    for (let i = 0; i < t.owed; i++) rail.push({ cls: 'owed' });
    for (let i = 0; i < t.fulfilled; i++) rail.push({ cls: 'paid' });
    if (!rail.length) rail.push({ cls: 'none' });
    return {
      tabRail: rail,
      tabRailLabel: t.earned ? plural(t.earned, 'beer', 'beers') + ' earned: ' + t.owed + ' owed, ' + t.fulfilled + ' settled' : 'No beers earned yet',
      tabCards: ctx.mem.map((m) => ({
        id: m.id, initial: m.initial, name: m.name, pints: m.pints, owed: m.owed, fulfilled: m.fulfilled, credit: m.credit, hasCredit: m.credit > 0,
        owedLabel: m.name + ' owes ' + plural(m.owed, 'beer', 'beers'),
        creditLabel: plural(m.credit, 'beer', 'beers') + ' of credit',
        cls: m.owed ? 'has' : '', owedCls: m.owed ? 'co' : '', noOwed: m.owed < 1, noPaid: m.paidCount < 1,
        settle: bind('settleBeer', { id: m.id }), undo: bind('undoBeer', { id: m.id })
      })),
      ledgerFilters: [['owed', 'Owed'], ['paid', 'Fulfilled'], ['all', 'All']].map((x) => ({ key: x[0], label: x[1], on: lf === x[0], cls: lf === x[0] ? 'on' : '', pick: bind('filterLedger', { key: x[0] }) })),
      log: shown, logAny: shown.length > 0, logEmpty: shown.length === 0
    };
  },

  history(ctx, bind) {
    const hf = ctx.S.histFilter;
    const rows = [...ctx.C.rows].reverse().filter((r) => hf === 'all' || !r.s.att[hf]);
    const historyMode = ctx.S.historyMode || 'live';
    const history = [];
    let month = '';
    rows.forEach((r) => {
      const label = fmtDate(r.s.date).month;
      if (label !== month) {
        month = label;
        history.push({ isHead: true, isRow: false, label: label, chips: [], effects: [], id: 0 });
      }
      history.push(sessionRow(ctx, bind, r));
    });
    const histFilters = [{ key: 'all', label: 'All', aria: 'All gatherings', on: hf === 'all', hasAvatar: false, initial: '', cls: hf === 'all' ? 'on' : '', pick: bind('filterHistory', { id: 'all' }) }]
      .concat(MEMBERS.map((m) => ({ key: m.id, label: m.name, aria: 'Gatherings missed by ' + m.name, on: hf === m.id, hasAvatar: true, initial: m.name[0], cls: hf === m.id ? 'on' : '', pick: bind('filterHistory', { id: m.id }) })));
    const archiveMembers = ctx.S.discordMembers || [];
    const archiveRows = [];
    const entries = [
      ...(ctx.S.discordEvents || []).map((event) => ({ kind: 'event', date: event.date, id: event.id, event: event })),
      ...(ctx.S.discordNotes || []).map((note) => ({ kind: 'note', date: note.date, id: 'note-' + note.id, note: note }))
    ].sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
    let archiveYear = '';
    const confidenceLabel = (value) => ({
      explicit: 'Date stated in Discord',
      'post-date': 'Date taken from Discord post',
      'inferred-weekly': 'Date inferred from weekly update',
      'inferred-post-date': 'Date inferred from update',
      'source-order-conflict': 'Source order conflicts with event date',
      'source-date-conflict': 'Event date conflicts with post timestamp'
    }[value] || 'Date source unclear');
    entries.forEach((entry) => {
      const year = entry.date.slice(0, 4);
      if (year !== archiveYear) {
        archiveYear = year;
        archiveRows.push({ isHead: true, isRow: false, label: year, id: 0 });
      }
      if (entry.kind === 'note') {
        const note = entry.note;
        const noteDate = fmtDate(note.date);
        const noteMembers = archiveMembers.map((m) => {
          const tally = note.tallies && note.tallies[m.id];
          return {
            id: m.id, name: m.name, statusText: 'Starting balance', strikesText: tally ? tally.strikes + ' strikes' : 'No tally',
            beerText: tally && tally.beerMarkers ? tally.beerMarkers : 'No beer marker in source'
          };
        }).filter((m) => note.tallies && note.tallies[m.id]);
        archiveRows.push({
          isHead: false, isRow: true, isNote: true, isEvent: false, id: entry.id, open: ctx.S.openId === entry.id,
          rowCls: ctx.S.openId === entry.id ? 'open' : '', dotCls: 'archive-note',
          day: noteDate.d, month: noteDate.mo, date: noteDate.when, title: note.type === 'baseline' ? 'Starting tally' : (note.type === 'status' ? 'Status note' : 'Discord note'),
          meta: note.text, sourcePostedAt: note.sourcePostedAt || '', confidence: '', chips: [], members: noteMembers,
          hasMembers: noteMembers.length > 0, hasSourceNote: false, sourceNote: '',
          toggle: bind('toggleDiscordRecord', { id: entry.id }), aria: note.type + ', ' + fmtDate(note.date).when + ', ' + note.text
        });
        return;
      }
      const event = entry.event;
      const eventDate = fmtDate(event.date);
      const states = archiveMembers.map((member) => {
        const status = event.attendance && event.attendance[member.id] ? event.attendance[member.id].status : 'unknown';
        const source = event.attendance && event.attendance[member.id] ? event.attendance[member.id] : {};
        const statusText = status === 'present' ? 'Present' : (status === 'absent' ? 'Absent' : 'Unknown');
        return {
          id: member.id, name: member.name, initial: member.name[0], status: status,
          statusText: statusText, cls: status === 'present' ? 'here' : (status === 'absent' ? 'gone' : 'unknown'),
          strikesText: source.strikes == null ? 'No tally in source' : source.strikes + ' strikes after event',
          beerText: source.beerMarkers || 'No beer marker in source snapshot',
          tip: member.name + ': ' + statusText + (source.strikes == null ? '' : ', ' + source.strikes + ' strikes') + (source.beerMarkers ? ', ' + source.beerMarkers : '')
        };
      });
      const presentCount = states.filter((m) => m.status === 'present').length;
      const absentCount = states.filter((m) => m.status === 'absent').length;
      const unknownCount = states.filter((m) => m.status === 'unknown').length;
      const eventMeta = [event.activity, event.game, event.location].filter(Boolean).join(' · ');
      archiveRows.push({
        isHead: false, isRow: true, isNote: false, isEvent: true, id: event.id, open: ctx.S.openId === event.id,
        rowCls: ctx.S.openId === event.id ? 'open' : '', dotCls: 'archive-event',
        day: eventDate.d, month: eventDate.mo, date: eventDate.when, title: event.title, eventMeta: eventMeta, hasEventMeta: !!eventMeta,
        countText: presentCount + ' present · ' + absentCount + ' absent · ' + unknownCount + ' unknown',
        confidence: confidenceLabel(event.dateConfidence), sourcePostedAt: event.sourcePostedAt || '',
        chips: states.map((m) => ({ initial: m.initial, cls: m.cls, tip: m.tip })),
        members: states, hasMembers: states.length > 0, hasSourceNote: !!event.sourceNote, sourceNote: event.sourceNote || '',
        toggle: bind('toggleDiscordRecord', { id: event.id }),
        aria: event.title + ', ' + fmtDate(event.date).when + ', ' + presentCount + ' present, ' + absentCount + ' absent, ' + unknownCount + ' unknown'
      });
    });
    return {
      historyModes: [
        { key: 'live', label: 'Gatherings', cls: historyMode === 'live' ? 'on' : '', on: historyMode === 'live', pick: bind('setHistoryMode', { mode: 'live' }) },
        { key: 'discord', label: 'Discord records', cls: historyMode === 'discord' ? 'on' : '', on: historyMode === 'discord', pick: bind('setHistoryMode', { mode: 'discord' }) }
      ],
      showLiveHistory: historyMode === 'live', showDiscordHistory: historyMode === 'discord',
      discordHistory: archiveRows, discordHistoryEmpty: (ctx.S.discordEvents || []).length === 0 && (ctx.S.discordNotes || []).length === 0,
      discordCount: (ctx.S.discordEvents || []).length,
      histFilters: histFilters, history: history, historyEmpty: rows.length === 0
    };
  },

  member(ctx, bind) {
    const C = ctx.C;
    const mm = ctx.mem.find((x) => x.id === ctx.S.memberId) || ctx.mem[0];
    const yOf = (v) => 100 - Math.max(2, Math.min(98, v * 100));
    const pts = (arr) => arr.map((v, i) => (C.count > 1 ? (i / (C.count - 1)) * 300 : 150).toFixed(1) + ',' + yOf(v).toFixed(1)).join(' ');
    const acts = Object.keys(mm.byActivity).map((k) => ({ k: k, v: Math.round(mm.byActivity[k].p * 100 / mm.byActivity[k].t), t: mm.byActivity[k].t })).sort((a, b) => b.v - a.v || b.t - a.t);
    const CIRC = 2 * Math.PI * 42;
    const goTo = (sid) => bind('openGathering', { id: sid });

    /* streaks drawn on the strip: runs of consecutive presence */
    const runs = [];
    let run = null;
    mm.cells.forEach((c, i) => {
      if (c.here) { if (!run) { run = { start: i, len: 0 }; runs.push(run); } run.len++; } else run = null;
    });
    const lastHere = mm.cells.length > 0 && mm.cells[mm.cells.length - 1].here;
    const current = lastHere ? runs[runs.length - 1] : null;
    let best = null;
    runs.forEach((r) => { if (!best || r.len >= best.len) best = r; });
    const inRun = (r, i) => !!r && i >= r.start && i < r.start + r.len;
    const endOf = (r, i) => !!r && i === r.start + r.len - 1;

    /* direct labels at the right end of the trend lines; nudged apart if they collide */
    const lastMe = mm.series.length ? mm.series[mm.series.length - 1] : 0;
    const lastAll = C.groupSeries.length ? C.groupSeries[C.groupSeries.length - 1] : 0;
    let topMe = yOf(lastMe); let topAll = yOf(lastAll);
    const GAP = 14;
    if (Math.abs(topMe - topAll) < GAP) {
      const mid = (topMe + topAll) / 2;
      const meAbove = topMe <= topAll;
      topMe = Math.max(4, Math.min(96, mid + (meAbove ? -GAP / 2 : GAP / 2)));
      topAll = Math.max(4, Math.min(96, mid + (meAbove ? GAP / 2 : -GAP / 2)));
    }

    return {
      switcher: ctx.mem.map((m) => ({ id: m.id, name: m.name, initial: m.initial, on: m.id === mm.id, cls: m.id === mm.id ? 'on' : '', pick: bind('openMember', { id: m.id }) })),
      mv: {
        id: mm.id, name: mm.name, pctText: mm.pctText, strikes: mm.strikes, owed: mm.owed, strikeLabel: mm.strikeLabel, pints: mm.pints,
        pintLabel: mm.earned.length ? plural(mm.earned.length, 'beer', 'beers') + ' earned: ' + mm.owed + ' owed, ' + mm.fulfilled + ' settled' : 'No beers earned',
        shift: liquidShift(mm.strikes), liqCls: liquidClass(mm.strikes),
        dash: ((mm.pct || 0) / 100 * CIRC).toFixed(1) + ' ' + CIRC.toFixed(1),
        fraction: C.count ? mm.attended + '/' + C.count : '',
        pctLabel: mm.pctText + ' attendance, ' + mm.attended + ' of ' + C.count + ' gatherings, ' + mm.missed + ' missed',
        hasData: C.count > 0, noData: C.count === 0, hasLine: C.count > 1,
        line: pts(mm.series), avg: pts(C.groupSeries),
        endMe: { top: topMe.toFixed(1), text: Math.round(lastMe * 100) + '%' },
        endAll: { top: topAll.toFixed(1), text: Math.round(lastAll * 100) + '%' },
        trendLabel: 'Attendance over time: ' + mm.name + ' ' + Math.round(lastMe * 100) + '%, group ' + Math.round(lastAll * 100) + '%',
        stripLabel: 'Attendance by gathering. Current streak ' + mm.streak + ', best ' + mm.best,
        cells: mm.cells.map((c, i) => {
          const isCur = inRun(current, i);
          const isBest = inRun(best, i);
          const num = endOf(current, i) ? current.len : (endOf(best, i) ? best.len : null);
          return {
            sid: c.sid, cls: cellCls(c) + (isCur ? ' streak' : '') + (isBest ? ' best' : ''),
            isGone: !c.here && !c.beer, isBeer: c.beer, hasNum: num != null, num: num,
            tip: fmtDate(c.date).when + ' · ' + c.activity + ' · ' + outcomeText(c),
            go: goTo(c.sid)
          };
        }),
        acts: acts.map((a) => ({ name: a.k, pct: a.v + '%', w: a.v + '%', aria: a.k + ': ' + a.v + '% of ' + plural(a.t, 'gathering', 'gatherings') })),
        hist: [...mm.cells].reverse().map((c) => ({
          sid: c.sid, cls: cellCls(c), isGone: !c.here && !c.beer, isBeer: c.beer, activity: c.activity, when: fmtDate(c.date).when,
          tip: c.activity + ', ' + fmtDate(c.date).when + ', ' + outcomeText(c), go: goTo(c.sid)
        }))
      }
    };
  }
};
