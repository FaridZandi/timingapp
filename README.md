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

Every observation is appended as one JSON object per line to:

```text
~/Library/Application Support/ActivityProbe/activity.jsonl
```

The file is preserved between runs. JSONL can be read incrementally, processed
with command-line tools, or imported into a database later.

View the latest observations:

```sh
tail -n 10 "$HOME/Library/Application Support/ActivityProbe/activity.jsonl"
```

Pretty-print one observation:

```sh
tail -n 1 "$HOME/Library/Application Support/ActivityProbe/activity.jsonl" | jq
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

Open <http://127.0.0.1:8765>. On startup, the server reads the existing JSONL
file and groups consecutive observations with the same application and window
title into activity periods. It then tails only newly appended bytes and streams
period changes to the page. The browser updates only the affected timeline block
and row; it does not reload or repeatedly process the full file.

The timeline initially fits the available activity and runs vertically from
earlier to later. Use the buttons to zoom, fit the observed data, or return to a
full-day view. Scrolling over the timeline zooms around the pointer, and dragging
empty timeline space pans vertically. Clicking an application block opens its
window-title subactivities in the detail pane.

At wider zoom levels, short nearby periods from the same application are
summarized into a larger time span. Isolated periods below roughly three
rendered pixels are omitted. After summarization, overlapping application spans
share equal-width lanes. Up to three applications are named directly; additional
overlapping applications are represented by a fourth **Other** lane. Zooming in
reduces summarization and restores the underlying periods.

To use another data file or port:

```sh
python3 dashboard/server.py --data ./activity.jsonl --port 9000
```
