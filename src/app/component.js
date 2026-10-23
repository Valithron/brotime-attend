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
