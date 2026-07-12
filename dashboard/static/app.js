const palette = [
  // The first eight are deliberately high-contrast for the most-used apps.
  "#3f51b5", "#d1495b", "#2a9d8f", "#8e5bb7",
  "#e09f3e", "#277da1", "#c4457a", "#5f6f89",
  "#4c956c", "#bc6c25", "#6c5ce7", "#e76f51",
  "#00a6a6", "#a44a3f", "#577590", "#b56576",
  "#3a86ff", "#ff006e", "#06d6a0", "#8338ec",
  "#fb5607", "#118ab2", "#ef476f", "#6a994e"
];
const tinyBlockPixels = 2;
const proximityMergePixels = 24;
const maxTimelineLanes = 5;

const elements = {
  addGoogleCalendar: document.querySelector("#add-google-calendar"),
  axis: document.querySelector("#axis"),
  blocks: document.querySelector("#blocks"),
  calendarStatus: document.querySelector("#calendar-status"),
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
  axisSelection: document.querySelector("#axis-selection"),
  clearAppFilter: document.querySelector("#clear-app-filter"),
  timelineFilter: document.querySelector("#timeline-filter"),
  timelineFilterApp: document.querySelector("#timeline-filter-app"),
  previousDay: document.querySelector("#previous-day"),
  nextDay: document.querySelector("#next-day"),
  range: document.querySelector("#range"),
  refresh: document.querySelector("#refresh"),
  status: document.querySelector("#status"),
  clearSubactivityFilter: document.querySelector("#clear-subactivity-filter"),
  subactivityFilterLabel: document.querySelector("#subactivity-filter-label"),
  subactivityControls: document.querySelector("#subactivity-controls"),
  subactivities: document.querySelector("#subactivities"),
  summaryAppCount: document.querySelector("#summary-app-count"),
  summaryApps: document.querySelector("#summary-apps"),
  summaryDate: document.querySelector("#summary-date"),
  summaryMetrics: document.querySelector("#summary-metrics"),
  timeline: document.querySelector("#timeline"),
  total: document.querySelector("#total"),
  today: document.querySelector("#today"),
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
  appFilter: null,
  subactivityFilter: null,
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

function rebuildColorAssignments() {
  const usage = new Map();
  for (const period of selectedDayPeriods()) {
    if (period.bundle_identifier === "__idle__") continue;
    const entry = usage.get(period.bundle_identifier) || {
      appName: period.app_name,
      bundleIdentifier: period.bundle_identifier,
      firstStart: period.clippedStart,
      intervals: []
    };
    entry.firstStart = Math.min(entry.firstStart, period.clippedStart);
    entry.intervals.push({
      start: period.clippedStart,
      end: period.clippedEnd
    });
    usage.set(period.bundle_identifier, entry);
  }

  const rankedApps = [...usage.values()]
    .map(app => ({
      ...app,
      duration: mergedIntervalDuration(app.intervals)
    }))
    .sort((left, right) =>
      right.duration - left.duration ||
      left.firstStart - right.firstStart ||
      left.bundleIdentifier.localeCompare(right.bundleIdentifier)
    );

  state.colorByApp.clear();
  state.nextColor = 0;
  rankedApps.forEach((app, index) => {
    state.colorByApp.set(
      app.bundleIdentifier,
      palette[index % palette.length]
    );
  });
}

function periodIsOnSelectedDay(period) {
  const bounds = dayBounds(elements.day.value);
  return (
    new Date(period.end).getTime() > bounds.start &&
    new Date(period.start).getTime() < bounds.end
  );
}

function isInactiveBundle(bundleIdentifier) {
  return bundleIdentifier === "__idle__";
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
  updateDayNavigation();
}

function updateDayNavigation() {
  const days = availableDays();
  const index = days.indexOf(elements.day.value);
  elements.previousDay.disabled = index === -1 || index >= days.length - 1;
  elements.nextDay.disabled = index <= 0;

  const today = localDay(new Date());
  const target = days.includes(today) ? today : days[0] || "";
  elements.today.disabled = !target || elements.day.value === target;
}

function selectDay(day) {
  if (!day || !availableDays().includes(day)) return;
  if (elements.day.value === day) {
    updateDayNavigation();
    return;
  }
  elements.day.value = day;
  renderSelectedDay();
}

function moveDay(direction) {
  const days = availableDays();
  const index = days.indexOf(elements.day.value);
  if (index === -1) return;
  selectDay(days[index + direction]);
}

function selectToday() {
  const days = availableDays();
  const today = localDay(new Date());
  selectDay(days.includes(today) ? today : days[0]);
}

function buildBlocks() {
  state.blocks = [];
  const bounds = dayBounds(elements.day.value);

  state.periods.forEach((period, periodIndex) => {
    if (
      !periodIsOnSelectedDay(period) ||
      period.bundle_identifier === "__idle__" ||
      (state.appFilter && period.bundle_identifier !== state.appFilter)
    ) {
      return;
    }
    const start = Math.max(new Date(period.start).getTime(), bounds.start);
    const end = Math.min(new Date(period.end).getTime(), bounds.end);
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
  const trackHeight = timelineTrackHeight();
  const millisecondsPerPixel =
    (state.viewportEnd - state.viewportStart) / trackHeight;
  const closeGapThreshold = millisecondsPerPixel * proximityMergePixels;
  const tinyBlockThreshold = millisecondsPerPixel * tinyBlockPixels;

  let displayBlocks = summarizeBlocksByApplication(
    tinyBlockThreshold,
    closeGapThreshold
  );
  for (const block of displayBlocks) {
    block.minimumPixels = tinyBlockPixels;
  }

  // Visibility is part of the layout model. Blocks that cannot be seen in
  // this viewport must not reserve a lane for blocks that can be seen.
  displayBlocks = displayBlocks.filter(isRenderableAtCurrentViewport);

  return assignOverlapLanes(
    limitMergesForLaneCapacity(displayBlocks, maxTimelineLanes)
  );
}

function timelineTrackHeight() {
  return Math.max(1, elements.timeline.clientHeight - 36);
}

function visiblePixelHeight(block) {
  if (state.viewportStart === null || state.viewportEnd === null) return 0;
  const visibleStart = Math.max(block.start, state.viewportStart);
  const visibleEnd = Math.min(block.end, state.viewportEnd);
  if (visibleEnd <= visibleStart) return 0;
  return (
    (visibleEnd - visibleStart) /
    (state.viewportEnd - state.viewportStart) *
    timelineTrackHeight()
  );
}

function isRenderableAtCurrentViewport(block) {
  return visiblePixelHeight(block) >= (block.minimumPixels || tinyBlockPixels);
}

function compareDisplayBlocks(left, right) {
  return (
    left.start - right.start ||
    left.end - right.end ||
    left.bundleIdentifier.localeCompare(right.bundleIdentifier) ||
    left.key.localeCompare(right.key)
  );
}

function basicDisplayBlock(block, rawIndex) {
  return {
    kind: "single",
    key: `basic:${rawIndex}`,
    rawIndices: [rawIndex],
    start: block.start,
    end: block.end,
    appName: block.appName,
    bundleIdentifier: block.bundleIdentifier,
    activeDuration: block.end - block.start,
    isSummarized: false
  };
}

function summarizedDisplayBlock(rawIndices) {
  const rawBlocks = rawIndices.map(index => state.blocks[index]);
  const first = rawBlocks[0];
  return {
    kind: "single",
    key: `summary:${first.bundleIdentifier}:${rawIndices[0]}:${rawIndices[rawIndices.length - 1]}`,
    rawIndices,
    start: rawBlocks[0].start,
    end: rawBlocks[rawBlocks.length - 1].end,
    appName: first.appName,
    bundleIdentifier: first.bundleIdentifier,
    activeDuration: rawBlocks.reduce(
      (total, block) => total + block.end - block.start,
      0
    ),
    isSummarized: true
  };
}

function summarizeBlocksByApplication(
  idleThreshold,
  closeGapThreshold
) {
  const idleNormalization = normalizeIdleBlocks(idleThreshold);
  const byApplication = new Map();
  const inactiveBlocks = idleNormalization.displayBlocks;
  state.blocks.forEach((block, rawIndex) => {
    if (
      block.bundleIdentifier === "__idle__" ||
      idleNormalization.suppressedRawIndices.has(rawIndex)
    ) {
      return;
    }
    const entries = byApplication.get(block.bundleIdentifier) || [];
    entries.push({ block, rawIndex });
    byApplication.set(block.bundleIdentifier, entries);
  });

  const result = [...idleNormalization.displayBlocks];
  for (const entries of byApplication.values()) {
    let index = 0;
    while (index < entries.length) {
      const current = entries[index];

      const candidates = [current];
      let cursor = index + 1;
      while (cursor < entries.length) {
        const previous = entries[cursor - 1].block;
        const next = entries[cursor].block;
        const crossesInactiveState = inactiveBlocks.some(inactive =>
          inactive.start < next.start && inactive.end > previous.end
        );
        const nextIsClose =
          !crossesInactiveState &&
          next.start - previous.end <= closeGapThreshold;
        if (!nextIsClose) break;
        candidates.push(entries[cursor]);
        cursor += 1;
      }

      if (candidates.length >= 2) {
        result.push(summarizedDisplayBlock(
          candidates.map(candidate => candidate.rawIndex)
        ));
      } else {
        result.push(basicDisplayBlock(current.block, current.rawIndex));
      }
      index = cursor;
    }
  }

  return result.sort(compareDisplayBlocks);
}

function normalizeIdleBlocks(ignoredBlockThreshold) {
  const displayBlocks = [];
  const suppressedRawIndices = new Set();
  const idleIndices = state.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.bundleIdentifier === "__idle__");
  let cursor = 0;

  while (cursor < idleIndices.length) {
    const first = idleIndices[cursor];
    const grouped = [first];
    let groupEnd = first.block.end;
    let nextCursor = cursor + 1;

    while (nextCursor < idleIndices.length) {
      const next = idleIndices[nextCursor];
      if (next.block.start - groupEnd > 15_000) break;

      const previousIndex = grouped[grouped.length - 1].index;
      for (let index = previousIndex + 1; index < next.index; index += 1) {
        suppressedRawIndices.add(index);
      }
      grouped.push(next);
      groupEnd = Math.max(groupEnd, next.block.end);
      nextCursor += 1;
    }

    const start = grouped[0].block.start;
    const end = Math.max(...grouped.map(({ block }) => block.end));
    if (end - start >= ignoredBlockThreshold) {
      displayBlocks.push({
        kind: "single",
        key: `idle:${grouped.map(({ index }) => index).join(":")}`,
        rawIndices: grouped.map(({ index }) => index),
        start,
        end,
        appName: "Idle",
        bundleIdentifier: "__idle__",
        activeDuration: grouped.reduce(
          (total, { block }) => total + block.end - block.start,
          0
        ),
        isSummarized: grouped.length > 1
      });
    }
    cursor = nextCursor;
  }

  return { displayBlocks, suppressedRawIndices };
}

function limitMergesForLaneCapacity(blocks, maxLanes) {
  let result = blocks.slice();
  let changed = true;

  while (changed) {
    changed = false;
    const next = [];
    const components = activeOverlapComponents(result);

    for (const component of components) {
      const expansion = bestExpansionForLaneCapacity(component.blocks, maxLanes);
      if (expansion) {
        changed = true;
        next.push(...expansion);
      } else {
        next.push(...component.blocks);
      }
    }

    result = next.sort(compareDisplayBlocks);
  }

  return result;
}

function bestExpansionForLaneCapacity(blocks, maxLanes) {
  if (intervalLaneCount(blocks) <= maxLanes) return null;

  const candidates = blocks.filter(canExpandSummarizedBlock);
  if (!candidates.length) return null;

  let best = null;
  for (const candidate of candidates) {
    const expanded = expandOneSummarizedBlock(blocks, candidate);
    const laneCount = intervalLaneCount(expanded);
    const penalty = candidate.rawIndices.length - 1;
    const score = {
      fixesCapacity: laneCount <= maxLanes,
      laneCount,
      penalty,
      activeDuration: candidate.activeDuration
    };

    if (!best || betterExpansionScore(score, best.score)) {
      best = { blocks: expanded, score };
    }
  }

  return best.blocks;
}

function betterExpansionScore(left, right) {
  if (left.fixesCapacity !== right.fixesCapacity) {
    return left.fixesCapacity;
  }
  if (!left.fixesCapacity && left.laneCount !== right.laneCount) {
    return left.laneCount < right.laneCount;
  }
  if (left.activeDuration !== right.activeDuration) {
    return left.activeDuration < right.activeDuration;
  }
  if (left.penalty !== right.penalty) {
    return left.penalty < right.penalty;
  }
  return left.laneCount < right.laneCount;
}

function expandOneSummarizedBlock(blocks, target) {
  const expanded = [];
  for (const block of blocks) {
    if (block === target) {
      expanded.push(...block.rawIndices
        .map(index => {
          const basic = basicDisplayBlock(state.blocks[index], index);
          basic.minimumPixels = block.minimumPixels ?? tinyBlockPixels;
          return basic;
        })
        .filter(isRenderableAtCurrentViewport));
    } else {
      expanded.push(block);
    }
  }
  return expanded.sort(compareDisplayBlocks);
}

function canExpandSummarizedBlock(block) {
  return (
    block.isSummarized &&
    !isInactiveBundle(block.bundleIdentifier) &&
    block.bundleIdentifier !== "__other__" &&
    block.rawIndices.length > 1 &&
    block.rawIndices.some(index => {
      const basic = basicDisplayBlock(state.blocks[index], index);
      basic.minimumPixels = block.minimumPixels ?? tinyBlockPixels;
      return isRenderableAtCurrentViewport(basic);
    })
  );
}

function activeOverlapComponents(blocks) {
  const components = [];
  let current = [];
  let currentEnd = -Infinity;

  for (const block of blocks.slice().sort(compareDisplayBlocks)) {
    if (isInactiveBundle(block.bundleIdentifier)) {
      if (current.length) components.push({ blocks: current });
      components.push({ blocks: [block] });
      current = [];
      currentEnd = -Infinity;
      continue;
    }

    if (current.length && block.start >= currentEnd) {
      components.push({ blocks: current });
      current = [];
      currentEnd = -Infinity;
    }
    current.push(block);
    currentEnd = Math.max(currentEnd, block.end);
  }

  if (current.length) components.push({ blocks: current });
  return components;
}

function intervalLaneCount(blocks) {
  const laneEnds = [];
  for (const block of blocks.slice().sort(compareDisplayBlocks)) {
    const laneIndex = laneEnds.findIndex(end => end <= block.start);
    if (laneIndex === -1) {
      laneEnds.push(block.end);
    } else {
      laneEnds[laneIndex] = block.end;
    }
  }
  return laneEnds.length;
}

function assignOverlapLanes(blocks) {
  const result = [];
  let component = [];
  let componentEnd = -Infinity;

  function allocateIntervalLanes(componentBlocks) {
    const laneEnds = [];
    const preferredLaneByBundle = new Map();
    const ordered = componentBlocks.slice().sort(compareDisplayBlocks);

    for (const block of ordered) {
      const preferredLane = preferredLaneByBundle.get(block.bundleIdentifier);
      const firstFreeLane = laneEnds.findIndex(end => end <= block.start);
      let laneIndex = (
        preferredLane !== undefined &&
        preferredLane < laneEnds.length &&
        laneEnds[preferredLane] <= block.start
      )
        ? preferredLane
        : firstFreeLane;

      if (laneIndex === -1) {
        laneIndex = laneEnds.length;
        laneEnds.push(-Infinity);
      }
      laneEnds[laneIndex] = block.end;
      preferredLaneByBundle.set(block.bundleIdentifier, laneIndex);
      block.laneIndex = laneIndex;
    }

    for (const block of componentBlocks) {
      block.laneCount = laneEnds.length;
    }
    return laneEnds.length;
  }

  function collapseOverflow(componentBlocks) {
    const totals = new Map();
    for (const block of componentBlocks) {
      const value = totals.get(block.bundleIdentifier) || {
        bundleIdentifier: block.bundleIdentifier,
        duration: 0,
        firstStart: block.start
      };
      value.duration += block.activeDuration;
      value.firstStart = Math.min(value.firstStart, block.start);
      totals.set(block.bundleIdentifier, value);
    }

    const retainedBundles = new Set(
      [...totals.values()]
        .sort((left, right) =>
          right.duration - left.duration || left.firstStart - right.firstStart
        )
        .slice(0, maxTimelineLanes - 1)
        .map(app => app.bundleIdentifier)
    );
    const explicit = componentBlocks.filter(
      block => retainedBundles.has(block.bundleIdentifier)
    );
    const overflow = componentBlocks
      .filter(block => !retainedBundles.has(block.bundleIdentifier))
      .sort(compareDisplayBlocks);
    const overflowGroups = [];

    for (const block of overflow) {
      const current = overflowGroups[overflowGroups.length - 1];
      if (current && block.start < current.end) {
        current.blocks.push(block);
        current.end = Math.max(current.end, block.end);
      } else {
        overflowGroups.push({
          blocks: [block],
          start: block.start,
          end: block.end
        });
      }
    }

    const otherBlocks = overflowGroups.map(group => ({
      kind: "single",
      key: `other:${group.blocks.map(block => block.key).join("|")}`,
      rawIndices: group.blocks.flatMap(block => block.rawIndices),
      start: group.start,
      end: group.end,
      appName: "Other",
      bundleIdentifier: "__other__",
      activeDuration: group.blocks.reduce(
        (total, block) => total + block.activeDuration,
        0
      ),
      isSummarized: true,
      minimumPixels: tinyBlockPixels
    }));
    return [...explicit, ...otherBlocks];
  }

  function finishComponent() {
    if (!component.length) return;

    let componentBlocks = component;
    if (allocateIntervalLanes(componentBlocks) > maxTimelineLanes) {
      componentBlocks = collapseOverflow(componentBlocks);
      allocateIntervalLanes(componentBlocks);
    }

    for (const block of componentBlocks) {
      result.push(block);
    }

    component = [];
    componentEnd = -Infinity;
  }

  for (const block of blocks) {
    if (isInactiveBundle(block.bundleIdentifier)) {
      finishComponent();
      block.laneIndex = 0;
      block.laneCount = 1;
      result.push(block);
      continue;
    }

    if (component.length && block.start >= componentEnd) {
      finishComponent();
    }
    component.push(block);
    componentEnd = Math.max(componentEnd, block.end);
  }
  finishComponent();

  result.sort((left, right) =>
    compareDisplayBlocks(left, right) || left.laneIndex - right.laneIndex
  );
  return result;
}

function positionBlock(node, block) {
  const span = state.viewportEnd - state.viewportStart;
  const visibleStart = Math.max(block.start, state.viewportStart);
  const visibleEnd = Math.min(block.end, state.viewportEnd);

  if (visibleEnd <= visibleStart) {
    node.hidden = true;
    return;
  }

  const top = (visibleStart - state.viewportStart) / span * 100;
  const height = (visibleEnd - visibleStart) / span * 100;
  const pixelHeight = visiblePixelHeight(block);

  node.hidden = false;
  node.style.top = `${top}%`;
  node.style.height = `${height}%`;

  node.classList.toggle("has-label", pixelHeight >= 30);
  node.classList.toggle("has-time", pixelHeight >= 54);
  node.classList.toggle("continues-before", Boolean(block.continuesBefore));
  node.classList.toggle("continues-after", Boolean(block.continuesAfter));

  if (block.kind === "single" && block.laneCount) {
    node.style.left = `${block.laneIndex / block.laneCount * 100}%`;
    node.style.width = `${100 / block.laneCount}%`;
  } else {
    node.style.left = "0";
    node.style.width = "100%";
  }
}

function createDisplayNode(block) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `activity-block ${block.kind}`;
  node.dataset.displayKey = block.key;

  const icon = document.createElement("img");
  icon.className = "activity-block-icon";
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  const fallback = document.createElement("i");
  fallback.className = "activity-block-icon-fallback";
  fallback.textContent = "⌘";
  fallback.setAttribute("aria-hidden", "true");
  const title = document.createElement("strong");
  const meta = document.createElement("span");
  node.append(icon, fallback, title, meta);
  return node;
}

function updateDisplayNode(node, block) {
  node.dataset.displayKey = block.key;
  node.classList.toggle("selected", state.selectedDisplayKey === block.key);
  node.classList.toggle("summarized", block.isSummarized);
  node.classList.toggle("idle", block.bundleIdentifier === "__idle__");

  const color = block.bundleIdentifier === "__other__"
    ? "#778087"
    : block.bundleIdentifier === "__idle__"
      ? "#a5a19a"
      : colorFor(block.bundleIdentifier);
  const durationKind = block.bundleIdentifier === "__idle__"
    ? "idle"
    : "active";
  node.style.setProperty("--block-color", color);
  const icon = node.querySelector(".activity-block-icon");
  const fallback = node.querySelector(".activity-block-icon-fallback");
  const hasIcon = block.bundleIdentifier !== "__other__" &&
    block.bundleIdentifier !== "__idle__";
  if (hasIcon) {
    const iconURL =
      `/api/app-icon?bundle_id=${encodeURIComponent(block.bundleIdentifier)}`;
    icon.onload = () => {
      icon.dataset.iconFailed = "false";
      icon.hidden = false;
      fallback.hidden = true;
    };
    icon.onerror = () => {
      icon.dataset.iconFailed = "true";
      icon.hidden = true;
      fallback.hidden = false;
    };
    if (icon.dataset.bundleIdentifier !== block.bundleIdentifier) {
      icon.dataset.bundleIdentifier = block.bundleIdentifier;
      icon.dataset.iconFailed = "false";
      icon.hidden = false;
      fallback.hidden = true;
      icon.src = iconURL;
    } else if (icon.dataset.iconFailed === "true") {
      icon.hidden = true;
      fallback.hidden = false;
    } else {
      icon.hidden = false;
      fallback.hidden = true;
    }
  } else {
    icon.hidden = true;
    fallback.hidden = false;
  }
  node.querySelector("strong").textContent = block.appName;
  node.querySelector("span").textContent =
    `${formatClock(block.start)} · ${formatDuration(block.activeDuration)} ${durationKind}`;
  const description =
    `${block.appName}\n${formatClock(block.start)}–${formatClock(block.end)}` +
    `\n${formatDuration(block.activeDuration)} total ${durationKind} time` +
    (block.isSummarized ? `\nSummarized from ${block.rawIndices.length} blocks` : "");
  node.title = description;
  node.setAttribute("aria-label", description.replaceAll("\n", ", "));

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

function timelineRatioAt(clientY) {
  const bounds = elements.timeline.getBoundingClientRect();
  const trackTop = bounds.top + 18;
  return Math.max(
    0,
    Math.min(1, (clientY - trackTop) / timelineTrackHeight())
  );
}

function updateAxisSelection(startRatio, endRatio) {
  const top = 18 + Math.min(startRatio, endRatio) * timelineTrackHeight();
  const height = Math.abs(endRatio - startRatio) * timelineTrackHeight();
  elements.axisSelection.hidden = height <= 0;
  elements.axisSelection.style.top = `${top}px`;
  elements.axisSelection.style.height = `${height}px`;
}

function clearAxisSelection() {
  elements.axisSelection.hidden = true;
  elements.axisSelection.style.removeProperty("top");
  elements.axisSelection.style.removeProperty("height");
}

function fitActivity({ render = true } = {}) {
  const bounds = dayBounds(elements.day.value);
  const activePeriods = selectedDayPeriods().filter(
    period => period.bundle_identifier !== "__idle__"
  );

  if (!activePeriods.length) {
    state.viewportStart = bounds.start;
    state.viewportEnd = bounds.end;
  } else {
    const first = activePeriods[0].clippedStart;
    const last = activePeriods[activePeriods.length - 1].clippedEnd;
    const padding = Math.max(60_000, (last - first) * 0.08);
    let start = Math.max(bounds.start, first - padding);
    let end = Math.min(bounds.end, last + padding);
    const minimumSpan = 60_000;

    if (end - start < minimumSpan) {
      const center = (start + end) / 2;
      start = Math.max(bounds.start, center - minimumSpan / 2);
      end = Math.min(bounds.end, start + minimumSpan);
      start = Math.max(bounds.start, end - minimumSpan);
    }

    state.viewportStart = start;
    state.viewportEnd = end;
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
  const observed = selectedDayActiveDuration();
  elements.status.textContent =
    `${state.observationCount.toLocaleString()} stored observations · live`;
  elements.total.textContent =
    `${state.displayBlocks.length} visible blocks · ${formatDuration(observed)} observed`;
  renderTimelineFilter();
}

function appNameForBundle(bundleIdentifier) {
  const period = selectedDayPeriods().find(
    candidate => candidate.bundle_identifier === bundleIdentifier
  );
  return period?.app_name || bundleIdentifier;
}

function renderTimelineFilter() {
  const active = Boolean(state.appFilter);
  elements.timelineFilter.hidden = !active;
  if (active) {
    elements.timelineFilterApp.textContent = appNameForBundle(state.appFilter);
  }
}

function setAppFilter(bundleIdentifier) {
  if (!bundleIdentifier || state.appFilter === bundleIdentifier) return;
  state.appFilter = bundleIdentifier;
  state.selectedDisplayKey = null;
  state.subactivityFilter = null;
  buildBlocks();
  renderDisplayBlocks();
  renderSummary();
  renderDailySummary();
  renderDetail();
}

function clearAppFilter() {
  if (!state.appFilter) return;
  state.appFilter = null;
  state.selectedDisplayKey = null;
  state.subactivityFilter = null;
  buildBlocks();
  renderDisplayBlocks();
  renderSummary();
  renderDailySummary();
  renderDetail();
}

function mergedIntervalDuration(intervals) {
  if (!intervals.length) return 0;
  const sorted = intervals
    .map(interval => ({ ...interval }))
    .sort((left, right) => left.start - right.start);
  let total = 0;
  let start = sorted[0].start;
  let end = sorted[0].end;

  for (const interval of sorted.slice(1)) {
    if (interval.start <= end) {
      end = Math.max(end, interval.end);
    } else {
      total += end - start;
      start = interval.start;
      end = interval.end;
    }
  }
  return total + end - start;
}

function selectedDayPeriods() {
  const bounds = dayBounds(elements.day.value);
  return state.periods
    .filter(periodIsOnSelectedDay)
    .map(period => ({
      ...period,
      clippedStart: Math.max(new Date(period.start).getTime(), bounds.start),
      clippedEnd: Math.min(new Date(period.end).getTime(), bounds.end)
    }))
    .filter(period => period.clippedEnd > period.clippedStart)
    .sort((left, right) => left.clippedStart - right.clippedStart);
}

function selectedDayActiveDuration() {
  return mergedIntervalDuration(
    selectedDayPeriods()
      .filter(period => period.bundle_identifier !== "__idle__")
      .map(period => ({
        start: period.clippedStart,
        end: period.clippedEnd
      }))
  );
}

function addSummaryMetric(value, label) {
  const metric = document.createElement("div");
  metric.className = "summary-metric";
  const number = document.createElement("strong");
  number.textContent = value;
  const caption = document.createElement("span");
  caption.textContent = label;
  metric.append(number, caption);
  elements.summaryMetrics.append(metric);
}

function renderDailySummary() {
  const periods = selectedDayPeriods();
  const activePeriods = periods.filter(
    period => period.bundle_identifier !== "__idle__"
  );
  const idlePeriods = periods.filter(
    period => period.bundle_identifier === "__idle__"
  );
  const activeDuration = mergedIntervalDuration(
    activePeriods.map(period => ({
      start: period.clippedStart,
      end: period.clippedEnd
    }))
  );
  const idleDuration = mergedIntervalDuration(
    idlePeriods.map(period => ({
      start: period.clippedStart,
      end: period.clippedEnd
    }))
  );

  const applications = new Map();
  for (const period of activePeriods) {
    const entry = applications.get(period.bundle_identifier) || {
      appName: period.app_name,
      bundleIdentifier: period.bundle_identifier,
      intervals: []
    };
    entry.intervals.push({
      start: period.clippedStart,
      end: period.clippedEnd
    });
    applications.set(period.bundle_identifier, entry);
  }
  const appRows = [...applications.values()]
    .map(app => ({
      ...app,
      duration: mergedIntervalDuration(app.intervals)
    }))
    .sort((left, right) => right.duration - left.duration);

  let switches = 0;
  let previousBundle = null;
  for (const period of activePeriods) {
    if (
      previousBundle !== null &&
      period.bundle_identifier !== previousBundle
    ) {
      switches += 1;
    }
    previousBundle = period.bundle_identifier;
  }

  elements.summaryDate.textContent = elements.day.selectedOptions[0]?.textContent || "";
  elements.summaryMetrics.replaceChildren();
  addSummaryMetric(formatDuration(activeDuration), "Active time");
  addSummaryMetric(formatDuration(idleDuration), "Idle time");
  addSummaryMetric(appRows.length.toLocaleString(), "Applications");
  addSummaryMetric(switches.toLocaleString(), "App switches");

  elements.summaryAppCount.textContent =
    `${appRows.length} ${appRows.length === 1 ? "application" : "applications"}`;
  elements.summaryApps.replaceChildren();

  if (!appRows.length) {
    const empty = document.createElement("p");
    empty.className = "summary-empty";
    empty.textContent = "No application activity for this day.";
    elements.summaryApps.append(empty);
    return;
  }

  for (const app of appRows) {
    const percentage = activeDuration > 0
      ? Math.min(100, app.duration / activeDuration * 100)
      : 0;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "summary-app-row";
    row.classList.toggle("active", state.appFilter === app.bundleIdentifier);
    row.addEventListener("click", () => setAppFilter(app.bundleIdentifier));

    const label = document.createElement("div");
    label.className = "summary-app-label";
    const icon = document.createElement("img");
    icon.className = "summary-app-icon";
    icon.alt = "";
    icon.src =
      `/api/app-icon?bundle_id=${encodeURIComponent(app.bundleIdentifier)}`;
    const marker = document.createElement("i");
    marker.style.background = colorFor(app.bundleIdentifier);
    marker.hidden = true;
    icon.addEventListener("error", () => {
      icon.hidden = true;
      marker.hidden = false;
    });
    const name = document.createElement("strong");
    name.textContent = app.appName;
    label.append(icon, marker, name);

    const bar = document.createElement("div");
    bar.className = "summary-app-bar";
    const fill = document.createElement("i");
    fill.style.background = colorFor(app.bundleIdentifier);
    fill.style.width = `${percentage}%`;
    bar.append(fill);

    const value = document.createElement("div");
    value.className = "summary-app-value";
    const duration = document.createElement("span");
    duration.textContent = formatDuration(app.duration);
    const percent = document.createElement("small");
    percent.textContent = `${Math.round(percentage)}%`;
    value.append(duration, percent);

    row.append(label, bar, value);
    elements.summaryApps.append(row);
  }
}

function normalizeWindowTitle(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return normalized || "No window title";
}

function buildSubactivityGroups(periodIndices, block) {
  const groups = new Map();
  for (const periodIndex of periodIndices) {
    const period = state.periods[periodIndex];
    const title = normalizeWindowTitle(period.window_title);
    const bundleIdentifier = block.bundleIdentifier === "__other__"
      ? period.bundle_identifier
      : block.bundleIdentifier;
    const key = `${bundleIdentifier}|${title}`;
    const group = groups.get(key) || {
      key,
      label: block.bundleIdentifier === "__other__"
        ? `${period.app_name} — ${title}`
        : title,
      periodIndices: [],
      intervals: []
    };
    group.periodIndices.push(periodIndex);
    group.intervals.push({
      start: new Date(period.start).getTime(),
      end: new Date(period.end).getTime()
    });
    groups.set(key, group);
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      activeDuration: mergedIntervalDuration(group.intervals)
    }))
    .sort((left, right) =>
      right.activeDuration - left.activeDuration ||
      left.label.localeCompare(right.label)
    );
}

function setSubactivityHighlight(groupKey, highlighted) {
  for (const node of elements.subactivities.querySelectorAll("[data-group-key]")) {
    node.classList.toggle(
      "highlighted",
      highlighted && node.dataset.groupKey === groupKey
    );
  }
}

function renderDetail() {
  const block = state.displayBlocks.find(
    candidate => candidate.key === state.selectedDisplayKey
  );
  if (!block) {
    state.subactivityFilter = null;
    elements.detailEmpty.hidden = false;
    elements.detailContent.hidden = true;
    elements.calendarStatus.textContent = "";
    elements.subactivityControls.hidden = true;
    return;
  }

  elements.detailEmpty.hidden = true;
  elements.detailContent.hidden = false;
  const rawBlocks = block.rawIndices.map(index => state.blocks[index]);
  const periodIndices = rawBlocks.flatMap(rawBlock => rawBlock.periodIndices);

  if (block.kind === "single") {
    elements.detailAccent.style.background = block.bundleIdentifier === "__other__"
      ? "#778087"
      : block.bundleIdentifier === "__idle__"
        ? "#a5a19a"
        : colorFor(block.bundleIdentifier);
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
    `${formatDuration(block.activeDuration)} ` +
    (block.bundleIdentifier === "__idle__" ? "idle" : "active");
  elements.detailCount.textContent =
    `${periodIndices.length} ${periodIndices.length === 1 ? "period" : "periods"}`;
  elements.addGoogleCalendar.disabled = block.bundleIdentifier === "__idle__";
  elements.addGoogleCalendar.textContent = block.bundleIdentifier === "__idle__"
    ? "Idle cannot be added"
    : "Add to Google Calendar";
  elements.calendarStatus.textContent = "";
  elements.calendarStatus.classList.remove("error");
  elements.subactivities.replaceChildren();

  const groups = buildSubactivityGroups(periodIndices, block);
  const selectedGroup = groups.find(
    group => group.key === state.subactivityFilter
  );
  if (state.subactivityFilter && !selectedGroup) {
    state.subactivityFilter = null;
  }
  elements.subactivityControls.hidden = !state.subactivityFilter;
  if (state.subactivityFilter) {
    elements.subactivityFilterLabel.textContent =
      `Filtered to “${selectedGroup.label}”`;
  }

  for (const group of groups) {
    if (state.subactivityFilter && group.key !== state.subactivityFilter) {
      continue;
    }

    const groupRow = document.createElement("button");
    groupRow.type = "button";
    groupRow.className = "subactivity-group";
    groupRow.dataset.groupKey = group.key;
    groupRow.classList.toggle("selected", group.key === state.subactivityFilter);
    groupRow.addEventListener("mouseenter", () =>
      setSubactivityHighlight(group.key, true)
    );
    groupRow.addEventListener("mouseleave", () =>
      setSubactivityHighlight(group.key, false)
    );
    groupRow.addEventListener("click", () => {
      state.subactivityFilter = group.key;
      renderDetail();
    });

    const groupTitle = document.createElement("strong");
    groupTitle.textContent = group.label;
    const groupTime = document.createElement("span");
    groupTime.textContent =
      `${group.periodIndices.length} ${group.periodIndices.length === 1 ? "period" : "periods"} · ` +
      `${formatDuration(group.activeDuration)}`;
    groupRow.append(groupTitle, groupTime);
    elements.subactivities.append(groupRow);

    for (const periodIndex of group.periodIndices) {
      const period = state.periods[periodIndex];
      const row = document.createElement("article");
      const start = new Date(period.start).getTime();
      const end = new Date(period.end).getTime();
      row.className = "subactivity";
      row.dataset.groupKey = group.key;
      row.addEventListener("mouseenter", () =>
        setSubactivityHighlight(group.key, true)
      );
      row.addEventListener("mouseleave", () =>
        setSubactivityHighlight(group.key, false)
      );

      const marker = document.createElement("i");
      marker.style.background = colorFor(period.bundle_identifier);
      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = block.bundleIdentifier === "__other__"
        ? `${period.app_name} — ${normalizeWindowTitle(period.window_title)}`
        : normalizeWindowTitle(period.window_title);
      const time = document.createElement("span");
      time.textContent =
        `${formatClock(start)}–${formatClock(end)} · ${formatDuration(end - start)}`;
      content.append(title, time);
      row.append(marker, content);
      elements.subactivities.append(row);
    }
  }
}

function selectedCalendarActivity() {
  const block = state.displayBlocks.find(
    candidate => candidate.key === state.selectedDisplayKey
  );
  if (!block || block.bundleIdentifier === "__idle__") return null;

  const rawBlocks = block.rawIndices.map(index => state.blocks[index]);
  const periodIndices = rawBlocks.flatMap(rawBlock => rawBlock.periodIndices);
  return {
    app_name: block.appName,
    bundle_identifier: block.bundleIdentifier,
    start: new Date(block.start).toISOString(),
    end: new Date(block.end).toISOString(),
    active_duration_ms: block.activeDuration,
    periods: periodIndices.map(index => {
      const period = state.periods[index];
      return {
        app_name: period.app_name,
        window_title: period.window_title,
        start: period.start,
        end: period.end
      };
    })
  };
}

async function addSelectedActivityToGoogleCalendar() {
  const activity = selectedCalendarActivity();
  if (!activity) return;

  elements.addGoogleCalendar.disabled = true;
  elements.addGoogleCalendar.textContent = "Summarizing…";
  elements.calendarStatus.textContent =
    "Window titles are being summarized by OpenAI.";
  elements.calendarStatus.classList.remove("error");

  try {
    const response = await fetch("/api/calendar/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(activity)
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Calendar request failed (${response.status}).`);
    }
    elements.calendarStatus.textContent = `Prepared “${result.title}”.`;
    window.location.assign(result.calendar_url);
  } catch (error) {
    elements.calendarStatus.textContent = error.message;
    elements.calendarStatus.classList.add("error");
  } finally {
    elements.addGoogleCalendar.disabled = false;
    elements.addGoogleCalendar.textContent = "Add to Google Calendar";
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
  state.appFilter = null;
  state.subactivityFilter = null;
  state.selectedDisplayKey = null;
  buildBlocks();
  rebuildColorAssignments();
  fitActivity({ render: false });
  elements.blocks.replaceChildren();
  renderDisplayBlocks();
  renderAxis();
  renderSummary();
  renderDailySummary();
  renderDetail();
  updateDayNavigation();
}

function applySnapshot(payload) {
  state.observationCount = payload.observation_count;
  state.periods = payload.periods;
  syncDayOptions();
  renderSelectedDay();
}

function appendOrUpdateBlock(periodIndex, previousPeriod) {
  const period = state.periods[periodIndex];
  if (
    period.bundle_identifier === "__idle__" ||
    (state.appFilter && period.bundle_identifier !== state.appFilter) ||
    !periodIsOnSelectedDay(period)
  ) {
    return;
  }

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
  renderDailySummary();

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
elements.addGoogleCalendar.addEventListener(
  "click",
  addSelectedActivityToGoogleCalendar
);
elements.day.addEventListener("change", () => {
  renderSelectedDay();
  updateDayNavigation();
});
elements.previousDay.addEventListener("click", () => moveDay(1));
elements.nextDay.addEventListener("click", () => moveDay(-1));
elements.today.addEventListener("click", selectToday);
elements.clearAppFilter.addEventListener("click", clearAppFilter);
elements.clearSubactivityFilter.addEventListener("click", () => {
  state.subactivityFilter = null;
  renderDetail();
});
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

let axisDrag = null;
elements.axis.addEventListener("pointerdown", event => {
  if (state.viewportStart === null || state.viewportEnd === null) return;
  event.preventDefault();
  event.stopPropagation();
  const ratio = timelineRatioAt(event.clientY);
  axisDrag = {
    pointerId: event.pointerId,
    startRatio: ratio,
    currentRatio: ratio
  };
  elements.axis.setPointerCapture(event.pointerId);
  updateAxisSelection(ratio, ratio);
});
elements.axis.addEventListener("pointermove", event => {
  if (!axisDrag || event.pointerId !== axisDrag.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  axisDrag.currentRatio = timelineRatioAt(event.clientY);
  updateAxisSelection(axisDrag.startRatio, axisDrag.currentRatio);
});

function finishAxisDrag(event, cancelled = false) {
  if (!axisDrag || event.pointerId !== axisDrag.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  const selection = axisDrag;
  axisDrag = null;
  if (elements.axis.hasPointerCapture(event.pointerId)) {
    elements.axis.releasePointerCapture(event.pointerId);
  }
  clearAxisSelection();

  if (cancelled) return;
  const startRatio = Math.min(selection.startRatio, selection.currentRatio);
  const endRatio = Math.max(selection.startRatio, selection.currentRatio);
  const span = state.viewportEnd - state.viewportStart;
  const start = state.viewportStart + span * startRatio;
  const end = state.viewportStart + span * endRatio;
  if (end - start >= 60_000) setViewport(start, end);
}

elements.axis.addEventListener("pointerup", event => finishAxisDrag(event));
elements.axis.addEventListener("pointercancel", event => finishAxisDrag(event, true));
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && axisDrag) {
    finishAxisDrag({
      pointerId: axisDrag.pointerId,
      preventDefault() {},
      stopPropagation() {}
    }, true);
  }
});

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
