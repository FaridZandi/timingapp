# Activity Probe — Development Action Plan

This plan is based on the current implementation and the open items in
`todo.md`. It deliberately prioritizes the timeline’s rendering model over
new features: several reported bugs share the same cause, and adding weekly
navigation or filters before fixing that model would duplicate the problem.

**Progress:** Phases 1.1 and 1.2 are implemented in
`dashboard/static/app.js`. The Phase 3.6 Idle-appearance experiment is also
implemented: Idle remains in the server data and daily aggregate, but is
excluded from timeline block construction. Phases 1.1–1.3 and Phases 2–4 are
now implemented; the remaining phases are pending.

## Current assessment

The dashboard has a solid data pipeline already:

- Swift records foreground observations into daily JSONL files.
- `dashboard/server.py` reconstructs active, passive, and Idle periods and
  streams changes to the page.
- `dashboard/static/app.js` builds base blocks, normalizes Idle, summarizes
  nearby same-app blocks, allocates up to five lanes, and renders the result.

The key weakness is the final two stages. `assignOverlapLanes()` allocates
lanes for every display block, but `positionBlock()` independently hides a
block whose visible height is below two pixels. A hidden block can therefore
reserve a lane and leave an apparent empty column. The same viewport-dependent
merge stage also changes the intervals presented to the lane allocator, so an
app can move between lanes after zooming or panning.

## Phase 1 — Make the timeline layout truthful and stable

**Goal:** every lane that the user sees corresponds to a rendered activity,
and a given app does not move lanes gratuitously while examining the same
interval.

### 1. Establish one renderable-block model

Target: `dashboard/static/app.js`

Replace the separate “allocate, then possibly hide” decisions with an explicit
render model built for the current viewport:

1. Build base blocks and apply Idle boundaries.
2. Merge nearby same-app blocks using the current 24-pixel proximity rule.
3. Clip every candidate to the viewport and calculate its rendered height.
4. Remove only candidates below the agreed extreme floor (currently 2px), or
   put them in an explicit compact/overflow representation if we retain one.
5. Allocate lanes from this renderable set only.
6. Render that same set without a second visibility rule that can disagree.

This directly fixes the reported half-width and two-thirds-width blocks with
empty neighbouring lanes. It also gives the footer an authoritative list of
what is on the screen.

**Acceptance checks**

- One visible app in an overlap region occupies the full width.
- Two visible apps occupy half-width lanes; no unused third lane remains.
- Panning a block partially out of view does not leave a phantom lane.
- Every retained display node has a visible geometry of at least the chosen
  floor.

### 2. Use deterministic lane identity

Target: `dashboard/static/app.js`

Keep the true interval allocator, but make its choices deterministic from a
stable input order and stable tie-breaks:

- sort by start time, then end time, then bundle identifier, then base block
  identity;
- continue to prefer an app’s earlier lane when it is free;
- choose the lowest free lane otherwise;
- preserve the lane assigned to a selected/merged block where that does not
  conflict with a simultaneous interval.

Do not use a globally permanent “one app always owns lane N” rule. That would
create avoidable empty space when the app is absent. The useful contract is
local stability: within the same connected overlap region, the same app keeps
its lane unless a real overlapping interval makes that impossible.

**Acceptance checks**

- Re-rendering an unchanged viewport produces identical lane indices.
- Minor scrolling or live updates do not cause unrelated blocks to swap lanes.
- A merge may widen a block, but does not make a non-conflicting app jump lanes.

### 3. Correct the footer’s observed-duration calculation — implemented

Target: `dashboard/static/app.js`

`renderSummary()` now calculates observed activity from the union of selected-
day reconstructed non-Idle periods instead of summing `state.blocks`, whose
combined base blocks can span short title-change gaps. This remains separate
from the number of currently visible display blocks, which is inherently zoom
dependent.

**Acceptance checks**

- The footer’s observed duration equals the active-time metric in the daily
  aggregate for the same day (subject only to clearly labelled state choices,
  such as passive time).
- Merging and zooming do not alter that duration.

## Phase 2 — Finish daily navigation and framing

**Goal:** make the existing daily timeline practical to browse before adding a
weekly view.

### 4. Add previous day, next day, and Today controls — implemented

Targets: `dashboard/static/index.html`, `dashboard/static/app.js`,
`dashboard/static/styles.css`

The day selector now has adjacent previous/next controls and Today. Navigation
skips dates without stored observations; Today selects the current local day if
it exists, otherwise the newest recorded day. Changing days clears selection,
rebuilds blocks, and uses the normal Fit framing.

### 5. Change Fit to ignore outer Idle periods — implemented

Target: `dashboard/static/app.js`

The fitted interval is now the first start through last end of non-Idle periods
for the selected day, with a small padding and a one-minute minimum viewport.
It falls back to the full day when there is no non-Idle activity. Idle within
that interval remains part of the day’s aggregate; only leading and trailing
Idle time is excluded from Fit.

**Acceptance checks**

- A 9am–5pm active day fits approximately that working interval, not midnight
  to midnight.
- A day containing only Idle has a safe, predictable full-day fallback.

## Phase 3 — Improve legibility and direct manipulation

**Goal:** make the timeline easier to scan without weakening the data model.

### 6. Decide and implement Idle’s visual role — implemented

Targets: `dashboard/static/app.js`, `dashboard/static/styles.css`

Current experiment: Idle is not rendered as a timeline card at all. It remains
in the server model and daily aggregate, but is excluded before timeline block
construction, so it does not reserve lanes, create merge boundaries, or affect
Fit framing. Same-app blocks may merge across it. Passive app activity remains
visible.

If this proves too opaque, the next alternative is a subtle background/label
treatment that restores an explicit visual cue without making Idle a lane.

### 7. Add axis drag-to-zoom — implemented

Targets: `dashboard/static/index.html`, `dashboard/static/app.js`,
`dashboard/static/styles.css`

Pointer drag on `#axis` now selects an interval while panning remains on the
empty timeline body. During drag, a selection overlay is aligned to the
timeline. On release:

- if the selected interval is at least the one-minute viewport minimum, call
  `setViewport()` with it;
- otherwise treat the gesture as a no-op;
- Escape/pointer cancellation clears the overlay.

The initial implementation deliberately has no animation; correctness and
gesture separation come first.

### 8. Make tiny blocks discoverable — implemented

Targets: `dashboard/static/app.js`, `dashboard/static/styles.css`

Small blocks retain native hover titles, now expose equivalent ARIA labels, and
have visible keyboard-focus styling. They are not artificially lengthened, so
their geometry remains truthful.

## Phase 4 — Filtering and subactivity exploration — implemented

**Goal:** turn the existing detail pane and daily summary into ways to answer
specific questions about a day.

### 9. Add an application filter from the daily aggregate — implemented

Targets: `dashboard/static/index.html`, `dashboard/static/app.js`,
`dashboard/static/styles.css`

Each application summary row is a button. A selected app filters the timeline
and detail data to that bundle identifier, shows a persistent clear filter
control, and makes the active filter visible above the timeline. Idle remains
excluded, and the unfiltered aggregate remains the day-wide summary. Filter
state survives zoom/pan and live updates but resets when the selected day
changes.

### 10. Group and filter subactivities — implemented

Target: `dashboard/static/app.js`

The detail pane uses exact normalized title grouping, not fuzzy matching:

- trim whitespace and collapse repeated whitespace;
- group exact normalized titles within the selected activity;
- render a count and union duration for each group;
- hovering a group highlights matching rows;
- clicking a group filters the detail list, with a clear action.

Exact grouping gives an understandable baseline. Only add similarity matching
after collecting examples of titles where exact matching is genuinely too
fragmented; fuzzy matching without user-visible rules would be hard to trust.

### 11. Add timeline app icons and a reliable fallback — implemented

Targets: `dashboard/static/app.js`, `dashboard/static/styles.css`, optionally
`dashboard/server.py`

The existing `/api/app-icon` endpoint is reused in labelled timeline blocks. A
generic app glyph is shown when an icon is missing, and icons are not displayed
inside sub-2px blocks.

## Phase 5 — Weekly view

**Goal:** give a high-level weekly scan without carrying the daily timeline’s
parallel-lane complexity into a smaller space.

### 12. Introduce a view model before a new layout

Targets: primarily `dashboard/static/app.js`, then `index.html` and
`styles.css`

Refactor selected-day assumptions into an explicit range/view state:

- `mode: "day" | "week"`;
- selected local date and derived local day/week bounds;
- data selection helpers that work for either range.

The server already supplies historical periods, so the first weekly view does
not require a new API. Keep live updates working by rebuilding only the day(s)
affected by an incoming period.

### 13. Build a seven-column single-lane weekly timeline

At each time slice, choose the app with the greatest active duration in that
slice. Use a fixed bucket size appropriate to the available height (start with
15 minutes), merge adjacent same-app buckets, and render one lane per day.
Show a tooltip with the winning duration and, when applicable, an indication
that other activity occurred. Do not reuse the daily 24-pixel merge rule here:
weekly summarization is a distinct, deliberately lossy view.

**Acceptance checks**

- Seven local calendar days appear in a stable Monday–Sunday (or locale-aware)
  order.
- Each day has one lane only.
- No week block claims more time than its underlying selected app had in its
  bucket.
- Selecting a day returns to the existing detailed daily view.

## Phase 6 — Notion integration, after the local workflow is stable

**Goal:** export a selected activity to a user-chosen Notion destination
without weakening the app’s local-first default.

### 14. Decide the real target and authentication model

“Notion Calendar” is not interchangeable with a public calendar-template URL
like Google Calendar. Before implementation, choose one supported target:

- a Notion database page with date/title/properties, via a Notion integration;
- or an external calendar that Notion Calendar displays.

The first option needs OAuth or a manually supplied Notion integration token,
a database picker/configuration, secure Keychain storage, and a local callback
listener or paste-back authorization flow. It should be designed as a provider
interface beside the existing Google export, not as a second copy of its
handler.

### 15. Implement the provider boundary and Notion flow

Targets: `Sources/ActivityProbe/APIKeyStore.swift`,
`Sources/ActivityProbe/ActivityProbeApp.swift`, `dashboard/server.py`,
`dashboard/static/app.js`

Define a provider-neutral activity-summary request and export result. Reuse
the existing local OpenAI summary only with clear disclosure that selected
window titles leave the Mac for summarization. Store Notion credentials in
Keychain, never JSONL or browser storage. Add explicit error states for missing
authorization, inaccessible database, and failed page creation.

## Verification strategy for every phase

- Add focused pure-JavaScript tests for interval merging, visibility selection,
  lane allocation, footer-duration union, and week bucketing. Extract these
  helpers from DOM code first if necessary.
- Keep a small deterministic fixture with sequential switches, a true overlap,
  tiny periods, leading/trailing Idle, and a passive-media period.
- Run `node --check dashboard/static/app.js` and `python3 -m py_compile
  dashboard/server.py` for dashboard changes.
- Run `swift build -c release` and `./scripts/build-app.sh` for app/package
  changes.
- Manually verify live updates in a browser after each rendering change;
  timeline correctness cannot be established by syntax checks alone.

## Recommended implementation order

1. Phase 1.1 and 1.2 together: renderable-block model and deterministic lane
   allocation.
2. Phase 1.3: footer duration correction.
3. Phase 2: daily navigation and Fit framing.
4. Phase 5: weekly view.
5. Phase 6: Notion integration once the target and credentials model are
   explicitly chosen.
