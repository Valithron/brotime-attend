/* =====================================================================
   BROTIME TRIBUNAL — how this file is organised (read this first)

   The script is layered so each layer can be read, tested and changed alone:

   1 CONFIG      constants: members, strike limit, default activities
   2 RULES       pure functions, no UI and no state. All strike / beer maths
                 lives here: computeSeason(), ledgerFor(), strikesBefore(),
                 findDuplicate(). Nothing is stored that can be derived.
   3 DATA        seed data + empty-season factory (swap for Cloudflare D1
                 queries in production; the shapes below are the table rows).
   4 ACTIONS     the ONLY place state changes. Each action is a pure reducer:
                 ACTIONS.name(state, payload) -> { patch, toast? }.
                 The UI never calls setState directly; it calls dispatch().
   5 SELECTORS   pure view-models: state -> exactly what each screen shows.
                 One selector per view; only the active view's selector runs.
   6 COMPONENT   thin glue: dispatch(), renderVals(), the agent API.

   DATA SHAPES
     Season   { id, name, closed, imported, sessions:[Session], paid:{memberId:[isoDate]} }
     Session  { id:number, date:'YYYY-MM-DD', activity, notes, att:{memberId:boolean} }
     State    { seasons, auth, viewId|null, view, role, memberId, histFilter,
                ledgerFilter, openId, menu, confirmNew, confirmDel, toast,
                form, nextId, today }
     view     'board' | 'member' | 'record' | 'ledger' | 'history'
     role     'admin' | 'member'      (set by the signed-in server session)

   BUSINESS RULES (all enforced in section 2)
     - every absence = 1 strike, no excuses
     - 5 strikes -> counter resets to 0, one beer obligation is earned
     - paying a beer never changes strikes
     - obligations and strikes are re-derived from sessions every render,
       so editing / deleting a gathering can never leave totals inconsistent
     - paid beers are stored as a list of dates per member; the oldest
       obligations are settled first; overpayment shows as credit

   VISUAL LANGUAGE (no captions; meaning is carried by form and colour)
     glass level = strikes (5 graduations)   foam cell   = present
     dashed cell = absent (an empty seat)    coral pint  = beer owed
     hollow blue pint = beer settled         amber run   = current streak
     amber underline  = best streak          order on the shelf = rank
     Every visual-only cue has an aria-label / title carrying it as text.

   AGENT HOOKS (AX)
     DOM   root [data-app="brotime-tribunal"] carries data-view, data-role,
           data-season, data-can-edit. Every control carries data-action plus
           data-member / data-gathering / data-target / data-filter /
           data-value where relevant. State-bearing nodes expose
           data-strikes, data-owed, data-settled, data-state, data-open.
     API   window.tribunal (set on mount):
             .actions               -> names of every ACTIONS reducer
             .dispatch(name, p)     -> runs an action, returns snapshot()
             .snapshot()            -> plain JSON: view, role, season,
                                       totals, per-member standing
             .state()               -> deep copy of raw state
     ACTIONS (payloads)
       nav {view}              toggleMenu {menu}
       closeMenu               pickSeason {id|null}    askNewSeason
       cancelNewSeason         startSeason
       openMember {id}         openGathering {id}      toggleGathering {id}
       filterHistory {id}      filterLedger {key}      setField {field,value}
       setAttendance {id,value:boolean}                setAllAttendance {value}
       startEdit {id}          cancelEdit              saveGathering
       deleteGathering (call twice: arm, then confirm) settleBeer {id}
       undoBeer {id}
   ===================================================================== */

/* ───────────── 1. CONFIG ───────────── */
const STRIKE_LIMIT = 5;
const MEMBERS = [
  { id: 's', name: 'Sterling' },
  { id: 'a', name: 'Adam' },
  { id: 'j', name: 'Julian' },
  { id: 'n', name: 'Nathan' },
  { id: 'i', name: 'Isaiah' }
];
const DEFAULT_ACTIVITIES = ['War Dogs', 'Poker', 'Disc golf', 'Board games', 'Movie night'];
const GLASS_INNER = 116; // liquid column height in the glass svg (user units)
