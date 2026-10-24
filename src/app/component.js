/* ───────────── 6. COMPONENT (thin glue) ───────────── */
class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = initialState(false);
    this.dispatch = this.dispatch.bind(this);
    this.bind = (name, payload) => () => this.dispatch(name, payload);
    const field = (name) => (e) => this.dispatch('setField', { field: name, value: e.target.value });
    this.fields = {
      setDate: field('date'), setActivity: field('activity'), setNotes: field('notes'),
      setGameChoice: field('gameChoice'), setGameOther: field('gameOther'),
      setLocationChoice: field('locationChoice'), setLocationOther: field('locationOther'),
      refreshData: () => { this.dispatch('closeMenu'); this.loadServerState(); }
    };
  }

  /* Single entry point for every user intent. See ACTIONS above. */
  dispatch(name, payload) {
    if (name === 'copyWeeklyRecap') {
      this.copyWeeklyRecap(payload);
      return;
    }
    if (name === 'selectShareFallback') {
      this.selectShareFallback();
      return;
    }
    if (['saveGathering', 'deleteGathering', 'settleBeer', 'undoBeer', 'startSeason'].includes(name)) {
      this.persistAction(name, payload || {});
      return;
    }
    const action = ACTIONS[name];
    if (!action) { console.warn('[tribunal] unknown action', name); return; }
    const result = action(this.state, payload || {}) || {};
    if (result.patch) this.setState(result.patch);
    if (result.toast) this.showToast(result.toast.text, !!result.toast.pint);
  }

  async copyWeeklyRecap(payload) {
    const selected = payload && payload.id != null ? eventForShare(this.state, payload.id, payload.archive) : null;
    const share = payload && payload.id != null ? {
      id: payload.id, complete: shareAttendanceComplete(selected),
      message: shareAttendanceComplete(selected) ? shareMessage(selected) : '',
      blockedText: 'Complete attendance for this event before sharing.'
    } : buildContext(this.state).share;
    if (!share.complete || !share.message) {
      this.showToast(share.blockedText || 'There is no completed gathering to share.', false);
      return;
    }
    if (this._shareTimer) clearTimeout(this._shareTimer);
    try {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null;
      if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('Clipboard API unavailable');
      await clipboard.writeText(share.message);
      this.setState({ share: { status: 'copied', text: '', error: '', id: share.id } });
      this._shareTimer = setTimeout(() => {
        const current = this.state.share || {};
        if (current.id === share.id && current.status === 'copied') this.setState({ share: { status: 'idle', text: '', error: '', id: null } });
      }, 2000);
    } catch (error) {
      this.setState({ share: { status: 'fallback', text: share.message, error: 'Clipboard access was unavailable. Select the message below and copy it manually.', id: share.id } });
    }
  }

  selectShareFallback() {
    const field = document.querySelector('[data-share-fallback]');
    if (field) {
      field.focus();
      field.select();
    }
  }

  showToast(text, pint) {
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this.setState({ toast: { text: text, pint: pint } });
    this._toastTimer = setTimeout(() => this.setState({ toast: null }), 3600);
  }

  /* Agent API + Escape-to-close. Nothing here mutates state except through dispatch(). */
  componentDidMount() {
    this._onKey = (e) => { if (e.key === 'Escape' && this.state.menu) this.dispatch('closeMenu'); };
    document.addEventListener('keydown', this._onKey);
    const snap = () => snapshotOf(buildContext(this.state));
    this._api = {
      actions: Object.keys(ACTIONS).concat(['copyWeeklyRecap', 'selectShareFallback']),
      dispatch: (name, payload) => { this.dispatch(name, payload); return snap(); },
      snapshot: snap,
      state: () => JSON.parse(JSON.stringify(this.state))
    };
    window.tribunal = this._api;
    this.loadServerState();
  }

  async loadServerState() {
    try {
      const prefetched = window.__brotimeStatePromise;
      window.__brotimeStatePromise = null;
      const data = prefetched ? await prefetched : await (async () => {
        const response = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Could not load the live tracker.');
        return body;
      })();
      const existing = this.state;
      const maxId = Math.max(0, ...data.seasons.flatMap((s) => s.sessions.map((x) => Number(x.id) || 0)));
      this.setState({
        ...existing,
        seasons: data.seasons,
        discordMembers: data.discordMembers || [],
        discordEvents: data.discordEvents || [],
        discordNotes: data.discordNotes || [],
        nextId: maxId
      });
    } catch (error) {
      this.showToast(error.message || 'Could not connect to the live tracker.', false);
    }
  }

  async persistAction(name, payload) {
    const S = this.state;
    if (name === 'deleteGathering' && !S.confirmDel) {
      const arm = ACTIONS.deleteGathering(S, payload || {});
      if (arm.patch) this.setState(arm.patch);
      return;
    }
    if (name === 'saveGathering') {
      if (!isFormComplete(S.form)) return;
      if (findDuplicate(currentSeason(S), S.form)) {
        this.showToast('A gathering with that date and activity already exists.', false);
        return;
      }
    }
    let url = '';
    let method = 'POST';
    let body = null;
    if (name === 'saveGathering') {
      const f = S.form;
      url = f.editId == null ? '/api/gatherings' : '/api/gatherings/' + encodeURIComponent(f.editId);
      method = f.editId == null ? 'POST' : 'PUT';
      body = {
        date: f.date,
        activity: f.activity,
        game: f.activity.trim().toLowerCase() === 'video games' ? selectedGame(f) : '',
        location: selectedLocation(f),
        notes: f.notes,
        attendance: f.att
      };
    } else if (name === 'deleteGathering') {
      url = '/api/gatherings/' + encodeURIComponent(S.form.editId);
      method = 'DELETE';
    } else if (name === 'settleBeer') {
      url = '/api/payments';
      body = { memberId: payload.id };
    } else if (name === 'undoBeer') {
      url = '/api/payments/reverse';
      body = { memberId: payload.id };
    } else if (name === 'startSeason') {
      url = '/api/seasons';
    } else {
      return;
    }
    if (this._mutationPending) return;
    this._mutationPending = true;
    try {
      const response = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
      });
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || 'The change could not be saved.');
        error.status = response.status;
        throw error;
      }
      await this.loadServerState();
      if (name === 'saveGathering') this.setState({ view: 'history', openId: result.id, histFilter: 'all', confirmDel: false, form: blankForm(this.state.today) });
      if (name === 'deleteGathering') this.setState({ view: 'history', openId: null, confirmDel: false, form: blankForm(this.state.today) });
      if (name === 'startSeason') this.setState({ view: 'board', viewId: null, menu: null, confirmNew: false, form: blankForm(this.state.today) });
      this.showToast(result.message || 'Saved.', false);
    } catch (error) {
      this.showToast(error.message || 'The change could not be saved.', false);
    } finally {
      this._mutationPending = false;
    }
  }

  componentWillUnmount() {
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
    if (this._toastTimer) clearTimeout(this._toastTimer);
    if (this._shareTimer) clearTimeout(this._shareTimer);
    if (window.tribunal === this._api) delete window.tribunal;
  }

  /* Only the shell and the active view are computed each render. */
  renderVals() {
    const ctx = buildContext(this.state);
    const viewSelector = SELECTORS[ctx.view] || SELECTORS.board;
    return {
      ...SELECTORS.shell(ctx, this.bind),
      ...viewSelector(ctx, this.bind),
      ...this.fields
    };
  }
}
