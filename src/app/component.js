/* ───────────── 6. COMPONENT (thin glue) ───────────── */
class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = initialState(false);
    this.dispatch = this.dispatch.bind(this);
    this.bind = (name, payload) => () => this.dispatch(name, payload);
    const field = (name) => (e) => this.dispatch('setField', { field: name, value: e.target.value });
    this.fields = { setDate: field('date'), setActivity: field('activity'), setNotes: field('notes') };
  }

  /* Single entry point for every user intent. See ACTIONS above. */
  dispatch(name, payload) {
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
      actions: Object.keys(ACTIONS),
      dispatch: (name, payload) => { this.dispatch(name, payload); return snap(); },
      snapshot: snap,
      state: () => JSON.parse(JSON.stringify(this.state))
    };
    window.tribunal = this._api;
    this.loadServerState();
  }

  async loadServerState() {
    let signInConfigured = false;
    try {
      const sessionResponse = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
      const session = await sessionResponse.json();
      if (!sessionResponse.ok) throw new Error(session.error || 'Could not check sign-in.');
      signInConfigured = !!session.configured;
      if (!session.authenticated) {
        const authError = new URLSearchParams(window.location.search).get('auth_error');
        const messages = {
          state: 'Discord sign-in expired. Please try again.',
          discord: 'Discord sign-in did not complete. Please try again.',
          not_allowed: 'This Discord account has not been added to Brotime.'
        };
        this.setState({ auth: {
          status: 'signedout', configured: !!session.configured,
          message: messages[authError] || (session.configured ? 'Sign in with an authorized Discord account to view the live tracker.' : 'Discord sign-in is not configured yet.')
        } });
        return;
      }
      const stateResponse = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-store' });
      const data = await stateResponse.json();
      if (!stateResponse.ok) throw new Error(data.error || 'Could not load the live tracker.');
      const existing = this.state;
      const maxId = Math.max(0, ...data.seasons.flatMap((s) => s.sessions.map((x) => Number(x.id) || 0)));
      this.setState({
        ...existing,
        seasons: data.seasons,
        nextId: maxId,
        role: session.user.role,
        memberId: session.user.memberId || existing.memberId,
        auth: { status: 'ready', configured: true, message: '', user: session.user }
      });
    } catch (error) {
        this.setState({ auth: {
          status: 'error', configured: signInConfigured,
          message: signInConfigured ? (error.message || 'Could not connect to the live tracker.') : 'Pages Functions and Discord sign-in are not configured for this preview.'
        } });
    }
  }

  async persistAction(name, payload) {
    const S = this.state;
    if (!S.auth || S.auth.status !== 'ready') return;
    if (S.role !== 'admin') { this.showToast('Only the administrator can change the live tracker.', false); return; }
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
      body = { date: f.date, activity: f.activity, notes: f.notes, attendance: f.att };
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
      if (error.status === 401 || error.status === 403) await this.loadServerState();
      this.showToast(error.message || 'The change could not be saved.', false);
    } finally {
      this._mutationPending = false;
    }
  }

  componentWillUnmount() {
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
    if (this._toastTimer) clearTimeout(this._toastTimer);
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
