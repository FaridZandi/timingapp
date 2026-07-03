#!/usr/bin/env python3

import argparse
import json
import queue
import statistics
import threading
import time
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_DATA = (
    Path.home()
    / "Library"
    / "Application Support"
    / "ActivityProbe"
    / "activity.jsonl"
)
STATIC_DIRECTORY = Path(__file__).parent / "static"


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


class ActivityModel:
    def __init__(self, data_path):
        self.data_path = data_path
        self.lock = threading.Lock()
        self.periods = []
        self.observation_count = 0
        self.interval = 5
        self.recent_times = []
        self.subscribers = set()
        self.file_offset = 0
        self.partial_line = b""
        self.stop_event = threading.Event()

    def start(self):
        self.reload()
        threading.Thread(target=self.watch, name="activity-file-watcher", daemon=True).start()

    def reload(self):
        observations = []
        data = b""

        try:
            with self.data_path.open("rb") as source:
                data = source.read()
                self.file_offset = source.tell()
        except FileNotFoundError:
            self.file_offset = 0

        lines = data.splitlines(keepends=True)
        self.partial_line = b""
        if lines and not lines[-1].endswith(b"\n"):
            self.partial_line = lines.pop()

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
            self.interval = statistics.median(normal_gaps) if normal_gaps else 5
            for observation in observations:
                self.add_observation_locked(observation)

        self.broadcast("reset", self.snapshot())

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
                ]
                self.interval = statistics.median(gaps)
                return
        self.recent_times.append(timestamp)
        self.recent_times = self.recent_times[-21:]

    def add_observation_locked(self, observation):
        timestamp = observation["_time"]
        self.update_interval_locked(timestamp)
        maximum_gap = max(15, self.interval * 3)
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
            return len(self.periods) - 1

        self.periods.append(
            {
                "_key": key,
                "_last_sample": timestamp,
                "start": timestamp,
                "end": timestamp + timedelta(seconds=self.interval),
                "app_name": observation.get("app_name", "Unknown"),
                "bundle_identifier": observation.get("bundle_identifier", "unknown"),
                "window_title": observation.get("window_title"),
                "samples": 1,
                "maximum_idle_seconds": observation.get("idle_seconds", 0),
            }
        )
        return len(self.periods) - 1

    def add_observation(self, observation):
        with self.lock:
            index = self.add_observation_locked(observation)
            message = {
                "index": index,
                "observation_count": self.observation_count,
                "period": serialize_period(self.periods[index]),
            }
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
        try:
            size = self.data_path.stat().st_size
        except FileNotFoundError:
            return

        if size < self.file_offset:
            self.reload()
            return
        if size == self.file_offset:
            return

        with self.data_path.open("rb") as source:
            source.seek(self.file_offset)
            chunk = source.read()
            self.file_offset = source.tell()

        lines = (self.partial_line + chunk).splitlines(keepends=True)
        self.partial_line = b""
        if lines and not lines[-1].endswith(b"\n"):
            self.partial_line = lines.pop()

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

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/periods":
            self.send_json(self.model.snapshot())
            return

        if path == "/api/events":
            self.stream_events()
            return

        super().do_GET()

    def send_json(self, value):
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(200)
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
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
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
