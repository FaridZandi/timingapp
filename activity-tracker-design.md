# Activity Tracker for macOS

## Product Definition

A private, local-first menu bar app that observes the foreground activity every five seconds and turns those observations into a searchable timeline.

It tracks:

- foreground application
- active window title, when permission is granted
- whether the user is active, idle, the screen is locked, or the Mac is asleep
- start time and duration of each continuous activity

It does **not** track:

- keystrokes
- clipboard contents
- screenshots
- document contents
- browser URLs in the first version
- anything while tracking is paused

The app should make its state obvious at all times and store everything locally.

## Main Experience

The app lives in the menu bar.

Clicking its icon shows:

- current activity: `Xcode — activity-tracker-design.md`
- elapsed time in the current activity
- **Pause for 15 minutes**
- **Pause until tomorrow**
- **Open Timeline**
- **Delete recent data**

The timeline groups raw observations into sessions:

```text
09:12–09:47  Xcode       activity-tracker-design.md       35m
09:47–09:51  Safari      Apple Developer Documentation     4m
09:51–10:04  Idle                                        13m
10:04–10:26  Xcode       ContentView.swift                22m
```

The useful views are:

1. **Today** — chronological timeline.
2. **Summary** — time by application and category.
3. **Search** — find sessions by application or window title.
4. **Settings** — privacy, retention, exclusions, and launch-at-login.

## Collection Model

Use a hybrid collector:

- Listen for foreground application changes immediately.
- Sample the current activity every five seconds.
- Listen for sleep, wake, lock, and unlock events.
- Mark the user idle after a configurable threshold, initially five minutes.

Five-second samples should not become permanent rows. The collector compares each observation with the open session:

```text
same app + same normalized title + same state
    → extend current session

anything changed
    → close current session and begin another
```

This keeps the database small. A full year should contain thousands of sessions, not millions of samples.

Short changes need a debounce rule. A title or app must remain changed for two consecutive samples before splitting a session. This prevents transient dialogs and notifications from fragmenting the timeline.

## macOS Implementation

### Technology

- Swift
- SwiftUI for the menu bar and timeline windows
- AppKit where SwiftUI does not expose the required macOS behavior
- SQLite through GRDB, or SQLite directly if keeping dependencies at zero
- macOS 13 or later

### Foreground Application

Read `NSWorkspace.shared.frontmostApplication` during each sample. Subscribe to `NSWorkspace.didActivateApplicationNotification` so app switches are captured without waiting for the next tick.

Store:

- localized application name
- bundle identifier
- process identifier only as temporary runtime information

### Active Window Title

Use the Accessibility API:

1. Create an application accessibility element from the foreground process ID.
2. Read its focused window.
3. Read the focused window title.

This requires the user to grant Accessibility permission in System Settings. The app must still work without it; sessions will contain application names but no window titles.

Window titles can contain sensitive information. Settings must support:

- disabling all title collection
- excluding titles for selected applications
- recording only the application name for private browsing
- adding replacement rules, such as converting every password-manager title to `Private`

### Idle, Sleep, and Lock

- Determine idle time from the elapsed time since the last user input event.
- Subscribe to workspace sleep and wake notifications.
- Subscribe to distributed session lock and unlock notifications where available.
- Never count sleep or locked time as application usage.

### Background Operation

The first version can be a menu bar application with no Dock icon. It remains running after its windows close.

Offer launch-at-login using `SMAppService`. A separate privileged daemon is unnecessary: collection only makes sense inside the signed-in graphical user session.

## Data Model

```sql
CREATE TABLE sessions (
    id              INTEGER PRIMARY KEY,
    started_at      REAL NOT NULL,
    ended_at        REAL NOT NULL,
    state           TEXT NOT NULL, -- active, idle, locked, sleep
    bundle_id       TEXT,
    app_name        TEXT,
    window_title    TEXT,
    title_hash      TEXT,
    source          TEXT NOT NULL DEFAULT 'automatic'
);

CREATE INDEX sessions_by_time
    ON sessions(started_at, ended_at);

CREATE INDEX sessions_by_app
    ON sessions(bundle_id, started_at);
```

Use UTC timestamps internally and the current system timezone for display.

The `title_hash` helps compare titles when title storage is disabled. It should be an HMAC using a random key stored in Keychain, not a plain hash that could be guessed.

Write through a serial database queue. On launch, close any session left open by a crash at its last observation time.

## Privacy and Safety Requirements

These are product requirements, not later polish:

- local storage only
- no account and no analytics
- tracking visibly indicated by the menu bar icon
- one-click pause
- per-application exclusions
- configurable retention: 7, 30, 90, or unlimited days
- delete a session, a time range, or all data
- database stored in the app container
- optional encrypted export; no automatic cloud synchronization

The app should explain why Accessibility access is requested before opening System Settings. Refusing permission must leave a useful app rather than a broken one.

## MVP Scope

Build only:

1. Menu bar app.
2. Five-second collector.
3. Foreground application and optional window title.
4. Active, idle, locked, and asleep states.
5. SQLite session compression.
6. Today timeline.
7. Pause, exclusions, retention, and deletion.
8. Launch at login.

Defer:

- browser URLs
- automatic activity categories
- summaries generated by AI
- screenshots
- mobile companion apps
- sync between Macs
- productivity scores

Browser URLs are especially unsuitable for the first version. Reliable capture varies by browser and can require browser extensions or Automation permission. Application and window-title tracking already produces a useful timeline.

## Build Sequence

### Milestone 1: Prove Collection

A command-line prototype prints one observation every five seconds and correctly reports app switches, titles, and idle time.

### Milestone 2: Persist Sessions

Add SQLite, session merging, debounce behavior, crash recovery, and automated tests around the session state machine.

### Milestone 3: Make It Operable

Add the menu bar UI, pause controls, permission explanation, exclusions, and launch at login.

### Milestone 4: Make It Useful

Add the Today timeline, search, summaries by app, retention, deletion, and export.

## Decisions to Validate Early

- Whether Accessibility-derived titles are reliable in the applications you use most.
- Whether five-second polling has a measurable battery impact.
- Whether title normalization should remove counters, dirty-state markers, and changing status text.
- Whether brief activities under 10–15 seconds should appear individually or merge into an `Other` segment.

The first technical spike should answer the first two questions before substantial UI work begins.
