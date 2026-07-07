# Activity Probe

A local-first macOS menu-bar app that records the foreground application,
focused window title, and keyboard/mouse idle time every five seconds. Its
browser dashboard turns those observations into a live timeline.

## Build the app

```sh
./scripts/build-app.sh
open "build/Activity Probe.app"
```

The build script creates an ad-hoc-signed app suitable for local development.
The app has no Dock icon; use its clock icon in the menu bar to open the
timeline in your browser, pause tracking, reveal the data file, or quit.

Do not keep the old `swift run activity-probe` process running after switching
to the app.

## Permissions and startup

Open **Settings** from the menu-bar item:

- Grant Accessibility access to collect focused window titles.
- The app registers itself with macOS Login Items on its first bundled launch.
  Use **Launch Activity Probe when I log in** to inspect or change that setting.
  macOS may require approval under **System Settings → General → Login Items**.

Keep the app at a stable path before granting either permission. Moving or
rebuilding an ad-hoc-signed app can require Accessibility approval again.

## Stored data

Every observation is appended as one JSON object per line. Files rotate at
local midnight and are named for the day on which their observations began:

```text
~/Library/Application Support/ActivityProbe/activity-YYYY-MM-DD.jsonl
```

Daily rotation bounds the size of each file while keeping the data directly
inspectable and easy to process with command-line tools.

View the latest observations:

```sh
tail -n 10 "$(find "$HOME/Library/Application Support/ActivityProbe" \
  -name 'activity-????-??-??.jsonl' -print | sort | tail -n 1)"
```

Pretty-print one observation:

```sh
tail -n 1 "$(find "$HOME/Library/Application Support/ActivityProbe" \
  -name 'activity-????-??-??.jsonl' -print | sort | tail -n 1)" | jq
```

Application names and idle time work without special permission. All
observations remain on this Mac, and the app makes no network requests.

## Web dashboard

**Open Timeline** starts the Python server bundled inside the app and opens
<http://127.0.0.1:8765> in the default browser. The server stops when the app
quits.

For dashboard development, it can also be run independently:

```sh
python3 dashboard/server.py
```

Open <http://127.0.0.1:8765>.

### How the timeline is prepared

The JSONL files remain the source of truth. The timeline is a derived view
created in two stages: the server reconstructs periods from observations, then
the browser adapts those periods to the selected day and current zoom level.

#### 1. Reconstruct periods on the server

On startup, the server reads and orders every valid JSONL observation. It
infers the normal sampling interval from recent gaps of at most 60 seconds,
falling back to five seconds when necessary.

Observations continue the same server period when they have the same application
bundle identifier and window title and arrive within the larger of:

- 15 seconds
- three inferred sampling intervals

Otherwise, the previous period closes and a new one begins. Periods preserve
their application, window title, sample count, maximum input-idle value, and
activity state.

#### 2. Reconstruct Idle and passive activity

The server derives state boundaries rather than charging every sample to its
foreground application:

- After two minutes without keyboard or pointer input, the preceding app period
  is retroactively trimmed to the last input timestamp.
- If no relevant display-sleep assertion exists, the remaining time becomes
  **Idle**.
- Every `loginwindow` observation is **Idle**, regardless of its idle counter.
- A missing-data gap becomes **Idle** when it exceeds the larger of 15 seconds
  or three expected sample intervals. The gap begins one expected interval
  after the preceding observation. Only gaps between known observations can be
  reconstructed.
- If an app is preventing display sleep, the period is attributed to that app
  using its real name and bundle identifier. Its metadata records
  `activity_state: passive`, but it is displayed and summarized like ordinary
  activity.
- If a passive assertion ends while no input occurs, the state changes from the
  attributed app to Idle. New input ends either state at the estimated input
  timestamp.

Historical observations recorded before passive assertion fields existed cannot
reliably distinguish playback from genuine Idle.

#### 3. Build application blocks for the selected day

The browser includes every server period that overlaps the selected local day
and clips periods at midnight when they cross a day boundary.

It first creates base application blocks. Adjacent server periods from the same
bundle are combined when their gap is at most 20 seconds. This removes
window-title fragmentation while retaining the original periods for the detail
pane.

#### 4. Normalize Idle for display

Idle is treated as a hard timeline boundary:

- Idle spans separated by at most 15 seconds are joined visually.
- Activity fragments between those joined Idle spans are suppressed from the
  display.
- An Idle span smaller than twelve rendered pixels is hidden.
- A visible Idle block never merges with an application, never participates in
  overlap lanes, and always occupies the full timeline width. Idle fragments
  hidden at the current zoom level do not split otherwise mergeable
  application blocks.

These operations only affect presentation. Source observations and reconstructed
server periods remain available.

#### 5. Apply zoom-dependent application summarization

The visible timeline determines a time-per-pixel scale:

```text
milliseconds per pixel = visible time span / timeline track height
```

For each application independently, blocks merge when the time between them is
no more than exactly **24 pixels** at the current zoom level. Individual block
duration does not affect eligibility. Application blocks never merge across an
Idle span that remains visible at the current zoom level.

Application visibility uses an adaptive threshold after same-app summarization:

- A block is **contended** when a different application overlaps it or lies
  within 12 rendered pixels. Contended blocks smaller than **12 pixels** are
  hidden.
- An application block without nearby contention is retained down to **5
  pixels**.
- The same threshold applies to portions clipped at the viewport edge.

Contention is measured before small blocks are removed, so hidden fragments
still contribute to classifying a crowded region. Zooming in separates blocks,
reduces contention, and reveals small fragments; zooming out combines nearby
work into longer summaries.

A summarized block has two different duration concepts:

- Its visual span runs from the first constituent block’s start to the final
  constituent block’s end.
- Its displayed active time is the sum of constituent block durations, excluding
  gaps enclosed by that visual span.

#### 6. Assign overlap lanes

After summarization, temporally overlapping blocks form connected overlap
regions. Within each region, blocks are processed in start-time order and use
the first lane whose previous block has ended. An application reuses its
previous lane when that lane is available. The region’s width is divided by its
maximum simultaneous overlap, not by the total number of applications that
appear anywhere in the region.

At most four lanes are displayed:

- If no more than four blocks overlap simultaneously, lanes are reused freely;
  any number of sequential applications can pass through the same lane.
- If concurrency exceeds four, the three applications with the greatest summed
  active duration remain explicit.
- Remaining applications are combined into **Other** blocks that preserve the
  union of their time spans rather than filling the entire overlap region.

Idle ends the current overlap region and remains full width.

#### 7. Draw and inspect blocks

Time runs vertically from earlier to later. Application colors are assigned by
bundle identifier for the current browser session; Idle and Other use neutral
colors.

Application names appear when a block is at least approximately 30 pixels tall.
Additional timing text appears at approximately 54 pixels. Hover text remains
available for smaller blocks.

Clicking a block opens the detail pane. The pane lists the original
window-title periods represented by that block. Clicking Other exposes periods
from all applications grouped into it.

### Daily aggregate

The section below the timeline summarizes reconstructed server periods for the
entire selected local day. Its values do not depend on the current zoom level or
visible timeline summaries.

It shows:

- **Active time** as the union of all non-Idle period intervals.
- **Idle time** as the union of all Idle intervals.
- The number of distinct non-Idle application bundle identifiers.
- Application switches after consecutive periods from the same app are
  collapsed; Idle does not itself count as an application switch.
- A duration-ranked application breakdown. Each app’s duration is the union of
  its periods, and its percentage is relative to total active time.

Aggregate values and application bars update as live periods arrive.

### Navigating the timeline

- **Fit** frames the available activity with a small amount of padding.
- **Day** displays midnight to midnight.
- **+** and **−** zoom around the center.
- Scrolling over the timeline zooms around the pointer.
- Dragging empty timeline space pans vertically.
- The minimum viewport is one minute.
- After manually zooming or panning, live updates do not reset that viewport.
  When live-edge following is active, the view advances as new activity reaches
  its lower boundary.

### Live updates

The server reads the daily JSONL files at startup. It then checks for growth
every 500 milliseconds and reads only newly appended bytes. When local midnight
creates a new daily file, the server discovers it and rebuilds once from the
complete set; ordinary live updates remain incremental. New observations update
the in-memory period model and are sent to connected pages using Server-Sent
Events.

The browser receives an initial snapshot followed by period updates. It
recomputes zoom-dependent summaries and overlap lanes, but reconciles timeline
elements by stable keys instead of reloading the page or recreating every
unchanged DOM node. The stream automatically reconnects if interrupted.

### Google Calendar export

Non-Idle blocks expose **Add to Google Calendar** in the detail pane. The export
uses the selected display block’s enclosing start and end times, summed active
duration, application name, and original window-title periods.

The workflow is:

1. Activity details are sent from the browser to the local dashboard server.
2. The server sends the application name, active minutes, and up to 60 unique
   window-title details to the OpenAI Responses API.
3. `gpt-5.4-mini` returns a structured calendar title and short factual
   description.
4. The server creates a prefilled Google Calendar event URL.
5. The timeline shows progress while waiting, then its current browser tab
   navigates to Google Calendar for review and saving.

The server does not insert an event directly and receives no Google account
credentials. The event’s calendar duration uses the block’s visual start and
end; its description includes the summed active time, which may be shorter when
the block summarizes activity separated by gaps.

Configure the OpenAI key from the Activity Probe menu-bar item under
**OpenAI API Key…**. The key is stored in macOS Keychain, is never sent to the
dashboard browser, and is passed to the bundled local server through its process
environment. Window titles are sent to OpenAI only after the calendar button is
clicked. OpenAI authenticates server requests using bearer API keys; keys should
not be exposed in browser code. See the
[OpenAI API authentication documentation](https://platform.openai.com/docs/api-reference/introduction)
and [Responses structured-output reference](https://platform.openai.com/docs/api-reference/responses).

When running the development server independently, provide the key in its
environment:

```sh
OPENAI_API_KEY="…" python3 dashboard/server.py
```

To use another Activity Probe data directory, a single JSONL file, or another
port:

```sh
python3 dashboard/server.py --data ./activity-data --port 9000
```
