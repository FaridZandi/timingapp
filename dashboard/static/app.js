const palette = [
  "#526ed3", "#d16854", "#368b68", "#9a61c7",
  "#bd842d", "#238894", "#c65388", "#667485"
];

const elements = {
  axis: document.querySelector("#axis"),
  blocks: document.querySelector("#blocks"),
  day: document.querySelector("#day"),
  detail: document.querySelector("#detail"),
  detailAccent: document.querySelector("#detail-accent"),
  detailApp: document.querySelector("#detail-app"),
  detailContent: document.querySelector("#detail-content"),
  detailCount: document.querySelector("#detail-count"),
  detailEmpty: document.querySelector("#detail-empty"),
  detailMeta: document.querySelector("#detail-meta"),
  fitActivity: document.querySelector("#fit-activity"),
  fullDay: document.querySelector("#full-day"),
  range: document.querySelector("#range"),
  refresh: document.querySelector("#refresh"),
  status: document.querySelector("#status"),
  subactivities: document.querySelector("#subactivities"),
  timeline: document.querySelector("#timeline"),
  total: document.querySelector("#total"),
  zoomIn: document.querySelector("#zoom-in"),
  zoomOut: document.querySelector("#zoom-out")
};

const state = {
  observationCount: 0,
  periods: [],
  blocks: [],
  displayBlocks: [],
  colorByApp: new Map(),
  nextColor: 0,
  selectedDisplayKey: null,
  viewportStart: null,
  viewportEnd: null,
  followingLiveEdge: true
};

function localDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayBounds(day) {
  return {
    start: new Date(`${day}T00:00:00`).getTime(),
    end: new Date(`${day}T24:00:00`).getTime()
  };
}

function formatClock(value) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const remainder = seconds % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function colorFor(bundleIdentifier) {
  if (!state.colorByApp.has(bundleIdentifier)) {
    state.colorByApp.set(bundleIdentifier, palette[state.nextColor % palette.length]);
    state.nextColor += 1;
  }
  return state.colorByApp.get(bundleIdentifier);
}

function periodIsOnSelectedDay(period) {
  return localDay(new Date(period.start)) === elements.day.value;
}

function availableDays() {
  return [...new Set(state.periods.map(period => localDay(new Date(period.start))))]
    .sort()
    .reverse();
}

function syncDayOptions() {
  const previous = elements.day.value;
  const days = availableDays();
  elements.day.replaceChildren();

  for (const day of days) {
    elements.day.add(new Option(
      new Intl.DateTimeFormat([], { dateStyle: "full" }).format(new Date(`${day}T12:00:00`)),
      day
    ));
  }

  if (days.includes(previous)) elements.day.value = previous;
}

function buildBlocks() {
  state.blocks = [];

  state.periods.forEach((period, periodIndex) => {
    if (!periodIsOnSelectedDay(period)) return;
    const start = new Date(period.start).getTime();
    const end = new Date(period.end).getTime();
    const previous = state.blocks[state.blocks.length - 1];
    const continues = previous
      && previous.bundleIdentifier === period.bundle_identifier
      && start - previous.end <= 20_000;

    if (continues) {
      previous.end = Math.max(previous.end, end);
      previous.periodIndices.push(periodIndex);
    } else {
      state.blocks.push({
        appName: period.app_name,
        bundleIdentifier: period.bundle_identifier,
        start,
        end,
        periodIndices: [periodIndex]
      });
    }
  });
}

function buildDisplayBlocks() {
  const trackHeight = Math.max(1, elements.timeline.clientHeight - 36);
  const millisecondsPerPixel =
    (state.viewportEnd - state.viewportStart) / trackHeight;
  const smallBlockThreshold = millisecondsPerPixel * 32;
  const closeGapThreshold = Math.min(
    120_000,
    Math.max(15_000, millisecondsPerPixel * 7)
  );
  const displayBlocks = [];
  let index = 0;

  while (index < state.blocks.length) {
    const first = state.blocks[index];
    const firstIsSmall = first.end - first.start <= smallBlockThreshold;

    if (!firstIsSmall) {
      displayBlocks.push(singleDisplayBlock(first, index));
      index += 1;
      continue;
    }

    const candidates = [index];
    let cursor = index + 1;
    while (cursor < state.blocks.length) {
      const previous = state.blocks[cursor - 1];
      const current = state.blocks[cursor];
      const isSmall = current.end - current.start <= smallBlockThreshold;
      const isClose = current.start - previous.end <= closeGapThreshold;
      if (!isSmall || !isClose) break;
      candidates.push(cursor);
      cursor += 1;
    }

    const appCount = new Set(
      candidates.map(rawIndex => state.blocks[rawIndex].bundleIdentifier)
    ).size;
    const shouldCluster =
      appCount >= 2 &&
      (
        candidates.length >= 3 ||
        candidates.every(rawIndex =>
          state.blocks[rawIndex].end - state.blocks[rawIndex].start
            <= millisecondsPerPixel * 12
        )
      );

    if (shouldCluster) {
      displayBlocks.push(clusterDisplayBlock(candidates));
    } else {
      candidates.forEach(rawIndex => {
        displayBlocks.push(singleDisplayBlock(state.blocks[rawIndex], rawIndex));
      });
    }
    index = cursor;
  }

  return displayBlocks;
}

function singleDisplayBlock(block, rawIndex) {
  return {
    kind: "single",
    key: `single:${rawIndex}`,
    rawIndices: [rawIndex],
    start: block.start,
    end: block.end,
    appName: block.appName,
    bundleIdentifier: block.bundleIdentifier
  };
}

function clusterDisplayBlock(rawIndices) {
  const rawBlocks = rawIndices.map(index => state.blocks[index]);
  const apps = new Map();

  for (const block of rawBlocks) {
    const existing = apps.get(block.bundleIdentifier) || {
      appName: block.appName,
      bundleIdentifier: block.bundleIdentifier,
      duration: 0,
      visits: 0
    };
    existing.duration += block.end - block.start;
    existing.visits += 1;
    apps.set(block.bundleIdentifier, existing);
  }

  return {
    kind: "cluster",
    key: `cluster:${rawIndices[0]}:${rawIndices[rawIndices.length - 1]}`,
    rawIndices,
    start: rawBlocks[0].start,
    end: rawBlocks[rawBlocks.length - 1].end,
    apps: [...apps.values()].sort((left, right) => right.duration - left.duration)
  };
}

function visibleClusterApps(block) {
  if (block.apps.length <= 3) return block.apps;

  const visible = block.apps.slice(0, 3);
  const remaining = block.apps.slice(3);
  visible.push({
    appName: "Other",
    bundleIdentifier: "__other__",
    duration: remaining.reduce((total, app) => total + app.duration, 0),
    visits: remaining.reduce((total, app) => total + app.visits, 0),
    groupedApps: remaining.map(app => app.appName)
  });
  return visible;
}

function positionBlock(node, block) {
  const span = state.viewportEnd - state.viewportStart;
  const visibleStart = Math.max(block.start, state.viewportStart);
  const visibleEnd = Math.min(block.end, state.viewportEnd);

  if (visibleEnd <= visibleStart) {
    node.hidden = true;
    return;
  }

  node.hidden = false;
  const top = (visibleStart - state.viewportStart) / span * 100;
  const height = (visibleEnd - visibleStart) / span * 100;
  node.style.top = `${top}%`;
  node.style.height = `${Math.max(0.3, height)}%`;

  const pixelHeight = height / 100 * elements.timeline.clientHeight;
  node.classList.toggle("has-label", pixelHeight >= 30);
  node.classList.toggle("has-time", pixelHeight >= 54);
}

function createDisplayNode(block) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `activity-block ${block.kind}`;
  node.dataset.displayKey = block.key;

  const title = document.createElement("strong");
  const meta = document.createElement("span");
  node.append(title, meta);

  if (block.kind === "cluster") {
    const apps = document.createElement("div");
    apps.className = "cluster-lanes";
    node.append(apps);
  }
  return node;
}

function updateDisplayNode(node, block) {
  node.dataset.displayKey = block.key;
  node.classList.toggle("selected", state.selectedDisplayKey === block.key);

  if (block.kind === "single") {
    const color = colorFor(block.bundleIdentifier);
    node.style.setProperty("--block-color", color);
    node.querySelector("strong").textContent = block.appName;
    node.querySelector("span").textContent =
      `${formatClock(block.start)} · ${formatDuration(block.end - block.start)}`;
    node.title =
      `${block.appName}\n${formatClock(block.start)}–${formatClock(block.end)}`;
  } else {
    const visibleApps = visibleClusterApps(block);
    const colors = visibleApps.map(app =>
      app.bundleIdentifier === "__other__"
        ? "#778087"
        : colorFor(app.bundleIdentifier)
    );
    node.style.setProperty("--block-color", colors[0]);
    const gradient = colors.length === 2
      ? `linear-gradient(180deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`
      : `linear-gradient(180deg, ${colors.map((color, index) => {
          const start = index / colors.length * 100;
          const end = (index + 1) / colors.length * 100;
          return `${color} ${start}% ${end}%`;
        }).join(", ")})`;
    node.style.setProperty("--cluster-stripe", gradient);
    node.querySelector("strong").textContent =
      `${block.apps.length} apps in rotation`;
    node.querySelector("span").textContent =
      `${formatClock(block.start)} · ${formatDuration(block.end - block.start)}`;
    node.title =
      `${block.apps.map(app => app.appName).join(", ")}\n` +
      `${formatClock(block.start)}–${formatClock(block.end)}`;

    const appList = node.querySelector(".cluster-lanes");
    appList.replaceChildren();
    for (const app of visibleApps) {
      const label = document.createElement("i");
      label.style.background = app.bundleIdentifier === "__other__"
        ? "#778087"
        : colorFor(app.bundleIdentifier);
      label.title =
        `${app.appName}: ${formatDuration(app.duration)} across ${app.visits} ` +
        `${app.visits === 1 ? "visit" : "visits"}` +
        (app.groupedApps ? `\n${app.groupedApps.join(", ")}` : "");
      label.textContent = app.appName;
      appList.append(label);
    }
  }

  positionBlock(node, block);
}

function renderDisplayBlocks() {
  const nextBlocks = buildDisplayBlocks();
  const existing = new Map(
    [...elements.blocks.querySelectorAll(".activity-block")]
      .map(node => [node.dataset.displayKey, node])
  );
  const retained = new Set();

  for (const block of nextBlocks) {
    let node = existing.get(block.key);
    if (!node || !node.classList.contains(block.kind)) {
      node?.remove();
      node = createDisplayNode(block);
      elements.blocks.append(node);
    }
    retained.add(block.key);
    updateDisplayNode(node, block);
  }

  for (const [key, node] of existing) {
    if (!retained.has(key)) node.remove();
  }

  state.displayBlocks = nextBlocks;
  if (
    state.selectedDisplayKey &&
    !nextBlocks.some(block => block.key === state.selectedDisplayKey)
  ) {
    state.selectedDisplayKey = null;
    renderDetail();
  }
}

function renderAxis() {
  elements.axis.replaceChildren();
  if (state.viewportStart === null) return;

  for (let index = 0; index <= 6; index += 1) {
    const ratio = index / 6;
    const timestamp =
      state.viewportStart + (state.viewportEnd - state.viewportStart) * ratio;
    const label = document.createElement("time");
    label.textContent = formatClock(timestamp);
    label.style.top = `${ratio * 100}%`;
    elements.axis.append(label);
  }

  elements.range.textContent =
    `${formatClock(state.viewportStart)}–${formatClock(state.viewportEnd)}`;
}

function repositionBlocks() {
  renderDisplayBlocks();
  renderAxis();
}

function setViewport(start, end, { follow = false } = {}) {
  const bounds = dayBounds(elements.day.value);
  const minimumSpan = 60_000;
  const span = Math.max(
    minimumSpan,
    Math.min(end - start, bounds.end - bounds.start)
  );
  let nextStart = Math.max(bounds.start, start);
  if (nextStart + span > bounds.end) nextStart = bounds.end - span;

  state.viewportStart = nextStart;
  state.viewportEnd = nextStart + span;
  state.followingLiveEdge = follow;
  repositionBlocks();
}

function fitActivity({ render = true } = {}) {
  const bounds = dayBounds(elements.day.value);

  if (!state.blocks.length) {
    state.viewportStart = bounds.start;
    state.viewportEnd = bounds.end;
  } else {
    const first = state.blocks[0].start;
    const last = state.blocks[state.blocks.length - 1].end;
    const padding = Math.max(60_000, (last - first) * 0.08);
    state.viewportStart = Math.max(bounds.start, first - padding);
    state.viewportEnd = Math.min(bounds.end, last + padding);
  }

  state.followingLiveEdge = true;
  if (render) repositionBlocks();
}

function showFullDay() {
  const bounds = dayBounds(elements.day.value);
  setViewport(bounds.start, bounds.end);
}

function zoom(factor, centerRatio = 0.5) {
  const oldSpan = state.viewportEnd - state.viewportStart;
  const center = state.viewportStart + oldSpan * centerRatio;
  const newSpan = oldSpan * factor;
  setViewport(
    center - newSpan * centerRatio,
    center + newSpan * (1 - centerRatio)
  );
}

function renderSummary() {
  const observed = state.blocks.reduce(
    (total, block) => total + block.end - block.start,
    0
  );
  elements.status.textContent =
    `${state.observationCount.toLocaleString()} stored observations · live`;
  elements.total.textContent =
    `${state.blocks.length} application periods · ${formatDuration(observed)} observed`;
}

function renderDetail() {
  const block = state.displayBlocks.find(
    candidate => candidate.key === state.selectedDisplayKey
  );
  if (!block) {
    elements.detailEmpty.hidden = false;
    elements.detailContent.hidden = true;
    return;
  }

  elements.detailEmpty.hidden = true;
  elements.detailContent.hidden = false;
  const rawBlocks = block.rawIndices.map(index => state.blocks[index]);
  const periodIndices = rawBlocks.flatMap(rawBlock => rawBlock.periodIndices);

  if (block.kind === "single") {
    elements.detailAccent.style.background = colorFor(block.bundleIdentifier);
    elements.detailApp.textContent = block.appName;
  } else {
    elements.detailAccent.style.background =
      `linear-gradient(90deg, ${
        block.apps.map(app => colorFor(app.bundleIdentifier)).join(", ")
      })`;
    elements.detailApp.textContent =
      block.apps.map(app => app.appName).join(" + ");
  }
  elements.detailMeta.textContent =
    `${formatClock(block.start)}–${formatClock(block.end)} · ` +
    formatDuration(block.end - block.start);
  elements.detailCount.textContent =
    block.kind === "cluster"
      ? `${rawBlocks.length} switches · ${block.apps.length} apps`
      : `${periodIndices.length} ${periodIndices.length === 1 ? "period" : "periods"}`;
  elements.subactivities.replaceChildren();

  for (const periodIndex of periodIndices) {
    const period = state.periods[periodIndex];
    const row = document.createElement("article");
    const start = new Date(period.start).getTime();
    const end = new Date(period.end).getTime();
    row.className = "subactivity";

    const marker = document.createElement("i");
    marker.style.background = colorFor(period.bundle_identifier);
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = block.kind === "cluster"
      ? `${period.app_name} — ${period.window_title || "No window title"}`
      : period.window_title || "No window title";
    const time = document.createElement("span");
    time.textContent =
      `${formatClock(start)}–${formatClock(end)} · ${formatDuration(end - start)}`;
    content.append(title, time);
    row.append(marker, content);
    elements.subactivities.append(row);
  }
}

function selectBlock(displayKey) {
  const previous = elements.blocks.querySelector(".activity-block.selected");
  previous?.classList.remove("selected");
  state.selectedDisplayKey = displayKey;
  const next = [...elements.blocks.querySelectorAll(".activity-block")]
    .find(node => node.dataset.displayKey === displayKey);
  next?.classList.add("selected");
  renderDetail();
}

function renderSelectedDay() {
  state.selectedDisplayKey = null;
  buildBlocks();
  fitActivity({ render: false });
  elements.blocks.replaceChildren();
  renderDisplayBlocks();
  renderAxis();
  renderSummary();
  renderDetail();
}

function applySnapshot(payload) {
  state.observationCount = payload.observation_count;
  state.periods = payload.periods;
  syncDayOptions();
  renderSelectedDay();
}

function appendOrUpdateBlock(periodIndex, previousPeriod) {
  const period = state.periods[periodIndex];
  if (!periodIsOnSelectedDay(period)) return;

  if (previousPeriod) {
    const blockIndex = state.blocks.findIndex(block =>
      block.periodIndices.includes(periodIndex)
    );
    if (blockIndex === -1) {
      renderSelectedDay();
      return;
    }
    const block = state.blocks[blockIndex];
    block.end = Math.max(...block.periodIndices.map(index =>
      new Date(state.periods[index].end).getTime()
    ));
    return;
  }

  const start = new Date(period.start).getTime();
  const end = new Date(period.end).getTime();
  const last = state.blocks[state.blocks.length - 1];

  if (
    last &&
    last.bundleIdentifier === period.bundle_identifier &&
    start - last.end <= 20_000
  ) {
    last.end = Math.max(last.end, end);
    last.periodIndices.push(periodIndex);
  } else {
    state.blocks.push({
      appName: period.app_name,
      bundleIdentifier: period.bundle_identifier,
      start,
      end,
      periodIndices: [periodIndex]
    });
  }
}

function applyPeriodChange(change) {
  const previousPeriod = state.periods[change.index];
  state.observationCount = change.observation_count;
  state.periods[change.index] = change.period;
  const previousDay = elements.day.value;
  syncDayOptions();

  if (elements.day.value !== previousDay) {
    renderSelectedDay();
    return;
  }

  appendOrUpdateBlock(change.index, previousPeriod);
  renderDisplayBlocks();
  if (state.selectedDisplayKey) renderDetail();
  renderSummary();

  const changedEnd = new Date(change.period.end).getTime();
  if (state.followingLiveEdge && changedEnd > state.viewportEnd) {
    const span = state.viewportEnd - state.viewportStart;
    const nextEnd = changedEnd + span * 0.08;
    setViewport(nextEnd - span, nextEnd, { follow: true });
  }
}

async function loadSnapshot() {
  const response = await fetch("/api/periods", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  applySnapshot(await response.json());
}

window.activityProbeReceive = (event, payload) => {
  if (event === "period") applyPeriodChange(payload);
  if (event === "reset") applySnapshot(payload);
};

function connectLiveStream() {
  const nativeBridge = window.webkit?.messageHandlers?.activityProbe;
  if (nativeBridge) {
    nativeBridge.postMessage({ type: "ready" });
    return;
  }

  const events = new EventSource("/api/events");
  events.addEventListener("period", event => applyPeriodChange(JSON.parse(event.data)));
  events.addEventListener("reset", event => applySnapshot(JSON.parse(event.data)));
  events.onerror = () => {
    elements.status.textContent =
      `${state.observationCount.toLocaleString()} stored observations · reconnecting…`;
  };
}

elements.blocks.addEventListener("click", event => {
  const block = event.target.closest(".activity-block");
  if (block) selectBlock(block.dataset.displayKey);
});
elements.day.addEventListener("change", renderSelectedDay);
elements.fitActivity.addEventListener("click", () => fitActivity());
elements.fullDay.addEventListener("click", showFullDay);
elements.zoomIn.addEventListener("click", () => zoom(0.5));
elements.zoomOut.addEventListener("click", () => zoom(2));
elements.refresh.addEventListener("click", () => {
  const nativeBridge = window.webkit?.messageHandlers?.activityProbe;
  if (nativeBridge) {
    nativeBridge.postMessage({ type: "refresh" });
  } else {
    loadSnapshot();
  }
});
elements.timeline.addEventListener("wheel", event => {
  event.preventDefault();
  const bounds = elements.timeline.getBoundingClientRect();
  zoom(Math.exp(event.deltaY * 0.002), (event.clientY - bounds.top) / bounds.height);
}, { passive: false });

let drag = null;
elements.timeline.addEventListener("pointerdown", event => {
  if (event.target.closest(".activity-block")) return;
  drag = {
    y: event.clientY,
    start: state.viewportStart,
    end: state.viewportEnd
  };
  elements.timeline.setPointerCapture(event.pointerId);
  elements.timeline.classList.add("dragging");
});
elements.timeline.addEventListener("pointermove", event => {
  if (!drag) return;
  const pixels = event.clientY - drag.y;
  const milliseconds =
    -pixels / elements.timeline.clientHeight * (drag.end - drag.start);
  setViewport(drag.start + milliseconds, drag.end + milliseconds);
});
elements.timeline.addEventListener("pointerup", event => {
  if (!drag) return;
  drag = null;
  elements.timeline.releasePointerCapture(event.pointerId);
  elements.timeline.classList.remove("dragging");
});

connectLiveStream();
