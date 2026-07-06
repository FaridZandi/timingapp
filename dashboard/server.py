#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import plistlib
import queue
import re
import statistics
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_DATA = (
    Path.home()
    / "Library"
    / "Application Support"
    / "ActivityProbe"
)
STATIC_DIRECTORY = Path(__file__).parent / "static"
IDLE_THRESHOLD_SECONDS = 120
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
MAX_CALENDAR_REQUEST_BYTES = 64 * 1024
APP_ICON_CACHE = Path.home() / "Library" / "Caches" / "ActivityProbe" / "icons"
VALID_BUNDLE_IDENTIFIER = re.compile(r"^[A-Za-z0-9._-]{1,200}$")
missing_app_icons = set()
app_icon_lock = threading.Lock()


def parse_timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def serialize_period(period):
    return {
        key: value.isoformat().replace("+00:00", "Z")
        if isinstance(value, datetime)
        else value
        for key, value in period.items()
        if not key.startswith("_")
    }


def resolve_app_icon(bundle_identifier):
    if not VALID_BUNDLE_IDENTIFIER.fullmatch(bundle_identifier):
        return None

    cache_name = hashlib.sha256(bundle_identifier.encode("utf-8")).hexdigest() + ".png"
    cached_icon = APP_ICON_CACHE / cache_name
    if cached_icon.is_file():
        return cached_icon

    with app_icon_lock:
        if cached_icon.is_file():
            return cached_icon
        if bundle_identifier in missing_app_icons:
            return None

        try:
            result = subprocess.run(
                [
                    "/usr/bin/mdfind",
                    "kMDItemCFBundleIdentifier == '{}'".format(bundle_identifier),
                ],
                capture_output=True,
                check=False,
                text=True,
                timeout=3,
            )
            app_paths = sorted(
                (
                    Path(line)
                    for line in result.stdout.splitlines()
                    if line.strip().endswith(".app")
                ),
                key=lambda path: (len(path.parts), len(str(path))),
            )

            source_icon = None
            for app_path in app_paths:
                info_path = app_path / "Contents" / "Info.plist"
                if not info_path.is_file():
                    continue
                with info_path.open("rb") as info_file:
                    info = plistlib.load(info_file)
                icon_name = info.get("CFBundleIconFile")
                if not isinstance(icon_name, str) or not icon_name:
                    continue
                if not Path(icon_name).suffix:
                    icon_name += ".icns"
                candidate = app_path / "Contents" / "Resources" / icon_name
                if candidate.is_file():
                    source_icon = candidate
                    break

            if source_icon is None:
                missing_app_icons.add(bundle_identifier)
                return None

            APP_ICON_CACHE.mkdir(parents=True, exist_ok=True)
            temporary_icon = cached_icon.with_suffix(".tmp.png")
            conversion = subprocess.run(
                [
                    "/usr/bin/sips",
                    "-s",
                    "format",
                    "png",
                    "-z",
                    "64",
                    "64",
                    str(source_icon),
                    "--out",
                    str(temporary_icon),
                ],
                capture_output=True,
                check=False,
                timeout=10,
            )
            if conversion.returncode != 0 or not temporary_icon.is_file():
                temporary_icon.unlink(missing_ok=True)
                missing_app_icons.add(bundle_identifier)
                return None
            temporary_icon.replace(cached_icon)
            return cached_icon
        except (OSError, plistlib.InvalidFileException, subprocess.SubprocessError):
            missing_app_icons.add(bundle_identifier)
            return None


class CalendarExportError(Exception):
    pass


def extract_response_text(response):
    for item in response.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                return content.get("text", "")
    raise CalendarExportError("The summarization service returned no text.")


def summarize_activity(activity, api_key):
    periods = activity.get("periods")
    if not isinstance(periods, list):
        raise CalendarExportError("Activity periods are missing.")

    details = []
    seen = set()
    for period in periods[:100]:
        if not isinstance(period, dict):
            continue
        title = str(period.get("window_title") or "").strip()
        app_name = str(period.get("app_name") or "").strip()
        if not title:
            continue
        detail = "{} — {}".format(app_name, title) if app_name else title
        detail = detail[:300]
        if detail not in seen:
            details.append(detail)
            seen.add(detail)

    prompt_input = {
        "application": str(activity.get("app_name") or "Activity")[:120],
        "active_minutes": round(
            max(0, float(activity.get("active_duration_ms") or 0)) / 60000,
            1,
        ),
        "window_titles": details[:60],
    }
    body = {
        "model": os.environ.get("OPENAI_SUMMARY_MODEL", "gpt-5.4-mini"),
        "instructions": (
            "Create a factual calendar entry from computer activity window titles. "
            "Do not invent projects, people, outcomes, or intent. Produce a concise "
            "3-8 word title and a one- or two-sentence description. Ignore repetitive "
            "UI suffixes and filenames when they do not add meaning."
        ),
        "input": json.dumps(prompt_input, ensure_ascii=False),
        "text": {
            "format": {
                "type": "json_schema",
                "name": "activity_calendar_event",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                    },
                    "required": ["title", "description"],
                    "additionalProperties": False,
                },
            }
        },
        "max_output_tokens": 300,
        "store": False,
    }
    request = urllib.request.Request(
        OPENAI_RESPONSES_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": "Bearer {}".format(api_key),
            "Content-Type": "application/json",
            "User-Agent": "ActivityProbe/0.1",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            payload = json.load(error)
            message = payload.get("error", {}).get("message")
        except (json.JSONDecodeError, AttributeError):
            message = None
        raise CalendarExportError(
            message or "The summarization service returned HTTP {}.".format(error.code)
        ) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise CalendarExportError(
            "Could not reach the summarization service."
        ) from error

    try:
        summary = json.loads(extract_response_text(result))
        title = str(summary["title"]).strip()
        description = str(summary["description"]).strip()
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise CalendarExportError(
            "The summarization service returned an invalid summary."
        ) from error

    if not title:
        raise CalendarExportError("The summarization service returned an empty title.")
    return {"title": title[:160], "description": description[:1200]}


def google_calendar_url(activity, summary):
    try:
        start = parse_timestamp(activity["start"])
        end = parse_timestamp(activity["end"])
    except (KeyError, TypeError, ValueError) as error:
        raise CalendarExportError("The activity has invalid start or end times.") from error
    if end <= start:
        raise CalendarExportError("The activity end must be after its start.")

    active_minutes = round(
        max(0, float(activity.get("active_duration_ms") or 0)) / 60000,
        1,
    )
    description = summary["description"]
    if active_minutes:
        description += "\n\nActivity Probe active time: {} minutes.".format(
            active_minutes
        )

    def calendar_time(value):
        return value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    query = urllib.parse.urlencode(
        {
            "action": "TEMPLATE",
            "text": summary["title"],
            "dates": "{}/{}".format(calendar_time(start), calendar_time(end)),
            "details": description,
        }
    )
    return "https://calendar.google.com/calendar/render?{}".format(query)


class ActivityModel:
    def __init__(self, data_path):
        self.data_path = data_path
        self.lock = threading.Lock()
        self.periods = []
        self.observation_count = 0
        self.interval = 5
        self.recent_times = []
        self.last_observation_time = None
        self.subscribers = set()
        self.file_offsets = {}
        self.partial_lines = {}
        self.stop_event = threading.Event()

    def start(self):
        self.reload()
        threading.Thread(target=self.watch, name="activity-file-watcher", daemon=True).start()

    def reload(self):
        observations = []
        self.file_offsets = {}
        self.partial_lines = {}

        for data_file in self.data_files():
            try:
                with data_file.open("rb") as source:
                    data = source.read()
                    self.file_offsets[data_file] = source.tell()
            except FileNotFoundError:
                continue

            lines = data.splitlines(keepends=True)
            self.partial_lines[data_file] = b""
            if lines and not lines[-1].endswith(b"\n"):
                self.partial_lines[data_file] = lines.pop()

            for line in lines:
                observation = self.decode_line(line)
                if observation:
                    observations.append(observation)

        observations.sort(key=lambda item: item["_time"])
        gaps = [
            (current["_time"] - previous["_time"]).total_seconds()
            for previous, current in zip(observations, observations[1:])
        ]
        normal_gaps = [gap for gap in gaps if 0 < gap <= 60]

        with self.lock:
            self.periods = []
            self.observation_count = 0
            self.recent_times = []
            self.last_observation_time = None
            self.interval = statistics.median(normal_gaps) if normal_gaps else 5
            for observation in observations:
                self.add_observation_locked(observation)

        self.broadcast("reset", self.snapshot())

    def data_files(self):
        if self.data_path.is_file():
            return [self.data_path]
        if not self.data_path.exists():
            return []

        return sorted(self.data_path.glob("activity-????-??-??.jsonl"))

    @staticmethod
    def decode_line(line):
        try:
            item = json.loads(line)
            item["_time"] = parse_timestamp(item["timestamp"])
            return item
        except (UnicodeDecodeError, json.JSONDecodeError, KeyError, ValueError):
            return None

    @staticmethod
    def activity_key(observation):
        return (
            observation.get("bundle_identifier", "unknown"),
            observation.get("window_title"),
        )

    def update_interval_locked(self, timestamp):
        if self.recent_times:
            gap = (timestamp - self.recent_times[-1]).total_seconds()
            if 0 < gap <= 60:
                self.recent_times.append(timestamp)
                self.recent_times = self.recent_times[-21:]
                gaps = [
                    (current - previous).total_seconds()
                    for previous, current in zip(self.recent_times, self.recent_times[1:])
                    if 0 < (current - previous).total_seconds() <= 60
                ]
                if gaps:
                    self.interval = statistics.median(gaps)
                return
        self.recent_times.append(timestamp)
        self.recent_times = self.recent_times[-21:]

    def add_observation_locked(self, observation):
        timestamp = observation["_time"]
        expected_interval = self.interval
        previous_observation_time = self.last_observation_time
        self.update_interval_locked(timestamp)
        self.last_observation_time = timestamp
        maximum_gap = max(15, self.interval * 3)
        idle_seconds = observation.get("idle_seconds", 0)
        is_loginwindow = (
            observation.get("bundle_identifier") == "com.apple.loginwindow"
            or observation.get("app_name", "").lower() == "loginwindow"
        )
        is_input_idle = (
            idle_seconds >= IDLE_THRESHOLD_SECONDS or is_loginwindow
        )
        passive_bundle = observation.get("passive_bundle_identifier")
        is_passive = (
            not is_loginwindow
            and idle_seconds >= IDLE_THRESHOLD_SECONDS
            and bool(passive_bundle)
        )

        changed_indices = []
        missing_gap_threshold = max(15, expected_interval * 3)
        if (
            previous_observation_time is not None
            and (timestamp - previous_observation_time).total_seconds()
                > missing_gap_threshold
            and self.periods
        ):
            gap_start = min(
                timestamp,
                previous_observation_time + timedelta(seconds=expected_interval),
            )
            gap_duration = max(0, (timestamp - gap_start).total_seconds())
            previous = self.periods[-1]

            if previous["_state"] == "idle":
                previous["end"] = timestamp
                previous["_last_sample"] = timestamp
                previous["maximum_idle_seconds"] = max(
                    previous["maximum_idle_seconds"],
                    gap_duration,
                )
                changed_indices.append(len(self.periods) - 1)
            elif gap_duration > 0:
                self.periods.append(
                    {
                        "_key": ("__idle__", None),
                        "_state": "idle",
                        "_last_sample": timestamp,
                        "start": gap_start,
                        "end": timestamp,
                        "app_name": "Idle",
                        "bundle_identifier": "__idle__",
                        "window_title": None,
                        "activity_state": "idle",
                        "passive_app_name": None,
                        "passive_bundle_identifier": None,
                        "samples": 0,
                        "maximum_idle_seconds": gap_duration,
                    }
                )
                changed_indices.append(len(self.periods) - 1)

        if is_passive:
            key = ("__passive__", passive_bundle)
        elif is_input_idle:
            key = ("__idle__", None)
        else:
            key = self.activity_key(observation)
        current = self.periods[-1] if self.periods else None
        continues = (
            current is not None
            and current["_key"] == key
            and (timestamp - current["_last_sample"]).total_seconds() <= maximum_gap
        )

        self.observation_count += 1

        if continues:
            current["_last_sample"] = timestamp
            current["end"] = timestamp + timedelta(seconds=self.interval)
            current["samples"] += 1
            current["maximum_idle_seconds"] = max(
                current["maximum_idle_seconds"],
                observation.get("idle_seconds", 0),
            )
            changed_indices.append(len(self.periods) - 1)
            return list(dict.fromkeys(changed_indices))

        start = timestamp
        current_is_inactive = (
            current is not None and current["_state"] in {"idle", "passive"}
        )
        next_is_inactive = is_input_idle

        if next_is_inactive and not current_is_inactive:
            start = (
                timestamp - timedelta(seconds=idle_seconds)
                if idle_seconds >= IDLE_THRESHOLD_SECONDS
                else timestamp
            )
            if current is not None:
                current["end"] = max(current["start"], min(current["end"], start))
                changed_indices.append(len(self.periods) - 1)
        elif next_is_inactive and current_is_inactive and current["_key"] != key:
            current["end"] = max(current["start"], min(current["end"], timestamp))
            changed_indices.append(len(self.periods) - 1)
        elif not next_is_inactive and current_is_inactive:
            start = timestamp - timedelta(seconds=idle_seconds)
            current["end"] = max(current["start"], min(current["end"], start))
            changed_indices.append(len(self.periods) - 1)

        if is_passive:
            app_name = observation.get("passive_app_name") or "Media"
            bundle_identifier = passive_bundle
            window_title = "Passive playback"
            activity_state = "passive"
        elif is_input_idle:
            app_name = "Idle"
            bundle_identifier = "__idle__"
            window_title = None
            activity_state = "idle"
        else:
            app_name = observation.get("app_name", "Unknown")
            bundle_identifier = observation.get("bundle_identifier", "unknown")
            window_title = observation.get("window_title")
            activity_state = "active"

        self.periods.append(
            {
                "_key": key,
                "_state": activity_state,
                "_last_sample": timestamp,
                "start": start,
                "end": timestamp + timedelta(seconds=self.interval),
                "app_name": app_name,
                "bundle_identifier": bundle_identifier,
                "window_title": window_title,
                "activity_state": activity_state,
                "passive_app_name": observation.get("passive_app_name"),
                "passive_bundle_identifier": passive_bundle,
                "samples": 1,
                "maximum_idle_seconds": idle_seconds,
            }
        )
        changed_indices.append(len(self.periods) - 1)
        return list(dict.fromkeys(changed_indices))

    def add_observation(self, observation):
        with self.lock:
            changed_indices = self.add_observation_locked(observation)
            messages = [
                {
                    "index": index,
                    "observation_count": self.observation_count,
                    "period": serialize_period(self.periods[index]),
                }
                for index in changed_indices
            ]
        for message in messages:
            self.broadcast("period", message)

    def snapshot(self):
        with self.lock:
            return {
                "data_file": str(self.data_path),
                "observation_count": self.observation_count,
                "periods": [serialize_period(period) for period in self.periods],
            }

    def subscribe(self):
        messages = queue.Queue(maxsize=100)
        with self.lock:
            self.subscribers.add(messages)
        return messages

    def unsubscribe(self, messages):
        with self.lock:
            self.subscribers.discard(messages)

    def broadcast(self, event, value):
        message = "event: {}\ndata: {}\n\n".format(
            event,
            json.dumps(value, separators=(",", ":")),
        )
        with self.lock:
            subscribers = list(self.subscribers)

        for subscriber in subscribers:
            try:
                subscriber.put_nowait(message)
            except queue.Full:
                try:
                    subscriber.get_nowait()
                    subscriber.put_nowait(message)
                except (queue.Empty, queue.Full):
                    pass

    def read_appended_data(self):
        data_files = self.data_files()
        if set(data_files) != set(self.file_offsets):
            self.reload()
            return

        for data_file in data_files:
            try:
                size = data_file.stat().st_size
            except FileNotFoundError:
                self.reload()
                return

            file_offset = self.file_offsets[data_file]
            if size < file_offset:
                self.reload()
                return
            if size == file_offset:
                continue

            with data_file.open("rb") as source:
                source.seek(file_offset)
                chunk = source.read()
                self.file_offsets[data_file] = source.tell()

            lines = (
                self.partial_lines.get(data_file, b"") + chunk
            ).splitlines(keepends=True)
            self.partial_lines[data_file] = b""
            if lines and not lines[-1].endswith(b"\n"):
                self.partial_lines[data_file] = lines.pop()

            for line in lines:
                observation = self.decode_line(line)
                if observation:
                    self.add_observation(observation)

    def watch(self):
        while not self.stop_event.wait(0.5):
            self.read_appended_data()


class DashboardHandler(SimpleHTTPRequestHandler):
    model = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIRECTORY), **kwargs)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path

        if path == "/api/periods":
            self.send_json(self.model.snapshot())
            return

        if path == "/api/events":
            self.stream_events()
            return

        if path == "/api/app-icon":
            query = urllib.parse.parse_qs(parsed_url.query)
            bundle_identifier = query.get("bundle_id", [""])[0]
            icon_path = resolve_app_icon(bundle_identifier)
            if icon_path is None:
                self.send_error(404)
                return
            icon = icon_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(icon)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(icon)
            return

        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/calendar/google":
            self.send_error(404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0 or content_length > MAX_CALENDAR_REQUEST_BYTES:
            self.send_json({"error": "Invalid request size."}, status=400)
            return

        try:
            activity = json.loads(self.rfile.read(content_length))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json({"error": "Invalid JSON request."}, status=400)
            return
        if not isinstance(activity, dict):
            self.send_json({"error": "Invalid activity request."}, status=400)
            return

        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            self.send_json(
                {
                    "error": (
                        "No OpenAI API key is configured. Add one from the "
                        "Activity Probe menu-bar menu."
                    )
                },
                status=503,
            )
            return

        try:
            summary = summarize_activity(activity, api_key)
            calendar_url = google_calendar_url(activity, summary)
        except CalendarExportError as error:
            self.send_json({"error": str(error)}, status=502)
            return

        self.send_json(
            {
                "calendar_url": calendar_url,
                "title": summary["title"],
                "description": summary["description"],
            }
        )

    def send_json(self, value, status=200):
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def stream_events(self):
        messages = self.model.subscribe()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        try:
            snapshot = "event: reset\ndata: {}\n\n".format(
                json.dumps(self.model.snapshot(), separators=(",", ":"))
            )
            self.wfile.write(snapshot.encode("utf-8"))
            self.wfile.flush()
            while True:
                try:
                    message = messages.get(timeout=15)
                except queue.Empty:
                    message = ": keepalive\n\n"
                self.wfile.write(message.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            self.model.unsubscribe(messages)

    def log_message(self, format, *args):
        if not self.path.startswith("/api/"):
            super().log_message(format, *args)


def main():
    parser = argparse.ArgumentParser(description="View Activity Probe data.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--data",
        type=Path,
        default=DEFAULT_DATA,
        help="Activity Probe data directory or a single JSONL file.",
    )
    arguments = parser.parse_args()

    model = ActivityModel(arguments.data.expanduser())
    model.start()
    DashboardHandler.model = model
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), DashboardHandler)

    print("Activity dashboard: http://127.0.0.1:{}".format(arguments.port))
    print("Reading: {}".format(model.data_path))
    print("Press Control-C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        model.stop_event.set()
        server.server_close()


if __name__ == "__main__":
    main()
