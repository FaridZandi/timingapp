import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import IOKit.pwr_mgt

struct Observation: Codable {
    let timestamp: Date
    let appName: String
    let bundleIdentifier: String
    let windowTitle: String?
    let idleSeconds: Double
    let passiveAppName: String?
    let passiveBundleIdentifier: String?

    enum CodingKeys: String, CodingKey {
        case timestamp
        case appName = "app_name"
        case bundleIdentifier = "bundle_identifier"
        case windowTitle = "window_title"
        case idleSeconds = "idle_seconds"
        case passiveAppName = "passive_app_name"
        case passiveBundleIdentifier = "passive_bundle_identifier"
        case schemaVersion = "schema_version"
    }

    init(
        timestamp: Date,
        appName: String,
        bundleIdentifier: String,
        windowTitle: String?,
        idleSeconds: Double,
        passiveAppName: String?,
        passiveBundleIdentifier: String?
    ) {
        self.timestamp = timestamp
        self.appName = appName
        self.bundleIdentifier = bundleIdentifier
        self.windowTitle = windowTitle
        self.idleSeconds = idleSeconds
        self.passiveAppName = passiveAppName
        self.passiveBundleIdentifier = passiveBundleIdentifier
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        timestamp = try values.decode(Date.self, forKey: .timestamp)
        appName = try values.decode(String.self, forKey: .appName)
        bundleIdentifier = try values.decode(String.self, forKey: .bundleIdentifier)
        windowTitle = try values.decodeIfPresent(String.self, forKey: .windowTitle)
        idleSeconds = try values.decode(Double.self, forKey: .idleSeconds)
        passiveAppName = try values.decodeIfPresent(String.self, forKey: .passiveAppName)
        passiveBundleIdentifier = try values.decodeIfPresent(
            String.self,
            forKey: .passiveBundleIdentifier
        )
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(2, forKey: .schemaVersion)
        try values.encode(timestamp, forKey: .timestamp)
        try values.encode(appName, forKey: .appName)
        try values.encode(bundleIdentifier, forKey: .bundleIdentifier)
        try values.encodeIfPresent(windowTitle, forKey: .windowTitle)
        try values.encode(idleSeconds, forKey: .idleSeconds)
        try values.encodeIfPresent(passiveAppName, forKey: .passiveAppName)
        try values.encodeIfPresent(
            passiveBundleIdentifier,
            forKey: .passiveBundleIdentifier
        )
    }
}

struct ActivityPeriod: Encodable {
    var start: Date
    var end: Date
    let appName: String
    let bundleIdentifier: String
    let windowTitle: String?
    var samples: Int
    var maximumIdleSeconds: Double

    enum CodingKeys: String, CodingKey {
        case start
        case end
        case appName = "app_name"
        case bundleIdentifier = "bundle_identifier"
        case windowTitle = "window_title"
        case samples
        case maximumIdleSeconds = "maximum_idle_seconds"
    }
}

struct ActivitySnapshot: Encodable {
    let dataFile: String
    let observationCount: Int
    let periods: [ActivityPeriod]

    enum CodingKeys: String, CodingKey {
        case dataFile = "data_file"
        case observationCount = "observation_count"
        case periods
    }
}

struct PeriodChange: Encodable {
    let index: Int
    let observationCount: Int
    let period: ActivityPeriod

    enum CodingKeys: String, CodingKey {
        case index
        case observationCount = "observation_count"
        case period
    }
}

final class ObservationStore {
    let fileURL: URL

    private let fileHandle: FileHandle
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init() throws {
        let applicationSupport = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = applicationSupport.appendingPathComponent(
            "ActivityProbe",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )

        fileURL = directory.appendingPathComponent("activity.jsonl")
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            FileManager.default.createFile(atPath: fileURL.path, contents: nil)
        }

        fileHandle = try FileHandle(forWritingTo: fileURL)
        try fileHandle.seekToEnd()

        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]

        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    deinit {
        try? fileHandle.close()
    }

    func append(_ observation: Observation) throws {
        var data = try encoder.encode(observation)
        data.append(0x0A)
        try fileHandle.write(contentsOf: data)
    }

    func readAll() -> [Observation] {
        guard
            let data = try? Data(contentsOf: fileURL),
            let text = String(data: data, encoding: .utf8)
        else {
            return []
        }

        return text
            .split(separator: "\n")
            .compactMap { line in
                try? decoder.decode(Observation.self, from: Data(line.utf8))
            }
            .sorted { $0.timestamp < $1.timestamp }
    }
}

struct PeriodAccumulator {
    private(set) var periods: [ActivityPeriod] = []
    private(set) var observationCount = 0
    private var recentTimestamps: [Date] = []
    private var interval: TimeInterval = 5

    mutating func rebuild(from observations: [Observation]) {
        periods = []
        observationCount = 0
        recentTimestamps = []

        let gaps = zip(observations, observations.dropFirst())
            .map { $1.timestamp.timeIntervalSince($0.timestamp) }
            .filter { $0 > 0 && $0 <= 60 }
            .sorted()
        if !gaps.isEmpty {
            interval = gaps[gaps.count / 2]
        }

        for observation in observations {
            _ = add(observation)
        }
    }

    mutating func add(_ observation: Observation) -> Int {
        updateInterval(using: observation.timestamp)
        observationCount += 1

        let maximumGap = max(15, interval * 3)
        if let lastIndex = periods.indices.last {
            let last = periods[lastIndex]
            let sameActivity =
                last.bundleIdentifier == observation.bundleIdentifier &&
                last.windowTitle == observation.windowTitle
            let gap = observation.timestamp.timeIntervalSince(last.end)

            if sameActivity && gap <= maximumGap {
                periods[lastIndex].end = observation.timestamp.addingTimeInterval(interval)
                periods[lastIndex].samples += 1
                periods[lastIndex].maximumIdleSeconds = max(
                    periods[lastIndex].maximumIdleSeconds,
                    observation.idleSeconds
                )
                return lastIndex
            }
        }

        periods.append(
            ActivityPeriod(
                start: observation.timestamp,
                end: observation.timestamp.addingTimeInterval(interval),
                appName: observation.appName,
                bundleIdentifier: observation.bundleIdentifier,
                windowTitle: observation.windowTitle,
                samples: 1,
                maximumIdleSeconds: observation.idleSeconds
            )
        )
        return periods.count - 1
    }

    private mutating func updateInterval(using timestamp: Date) {
        if let previous = recentTimestamps.last {
            let gap = timestamp.timeIntervalSince(previous)
            if gap > 0 && gap <= 60 {
                recentTimestamps.append(timestamp)
                recentTimestamps = Array(recentTimestamps.suffix(21))
                let gaps = zip(recentTimestamps, recentTimestamps.dropFirst())
                    .map { $1.timeIntervalSince($0) }
                    .sorted()
                if !gaps.isEmpty {
                    interval = gaps[gaps.count / 2]
                }
                return
            }
        }
        recentTimestamps.append(timestamp)
        recentTimestamps = Array(recentTimestamps.suffix(21))
    }
}

func focusedWindowTitle(processIdentifier: pid_t) -> String? {
    guard AXIsProcessTrusted() else {
        return nil
    }

    let application = AXUIElementCreateApplication(processIdentifier)
    var windowValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        application,
        kAXFocusedWindowAttribute as CFString,
        &windowValue
    ) == .success, let windowValue else {
        return nil
    }

    let window = unsafeDowncast(windowValue, to: AXUIElement.self)
    var titleValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        window,
        kAXTitleAttribute as CFString,
        &titleValue
    ) == .success else {
        return nil
    }
    return titleValue as? String
}

struct PassiveActivity {
    let appName: String
    let bundleIdentifier: String
}

func passiveActivityOwner(
    frontmostApplication: NSRunningApplication?
) -> PassiveActivity? {
    var unmanagedAssertions: Unmanaged<CFDictionary>?
    guard
        IOPMCopyAssertionsByProcess(&unmanagedAssertions) == kIOReturnSuccess,
        let unmanagedAssertions
    else {
        return nil
    }

    let assertionsByProcess = unmanagedAssertions.takeRetainedValue() as NSDictionary
    var candidates: [NSRunningApplication] = []

    for (key, value) in assertionsByProcess {
        guard
            let processIdentifier = (key as? NSNumber)?.int32Value,
            let assertions = value as? [NSDictionary],
            assertions.contains(where: { assertion in
                let type = assertion["AssertType"] as? String
                let level = (assertion["AssertLevel"] as? NSNumber)?.intValue ?? 255
                return type == "PreventUserIdleDisplaySleep" && level != 0
            }),
            let application = NSRunningApplication(
                processIdentifier: processIdentifier
            )
        else {
            continue
        }
        candidates.append(application)
    }

    let frontmostRelatedOwner = candidates.first(where: {
        guard
            let candidateBundle = $0.bundleIdentifier,
            let frontmostBundle = frontmostApplication?.bundleIdentifier
        else {
            return false
        }
        return candidateBundle.hasPrefix(frontmostBundle)
    })

    let owner = candidates.first(where: {
        $0.processIdentifier == frontmostApplication?.processIdentifier
    }) ?? frontmostRelatedOwner ?? candidates.first(where: {
        $0.activationPolicy == .regular
    }) ?? candidates.first

    guard let owner else { return nil }

    // Browser media assertions may belong to a helper process. Attribute them
    // to the frontmost parent app when their bundle identifiers share a prefix.
    if
        let frontmostApplication,
        let ownerBundle = owner.bundleIdentifier,
        let frontmostBundle = frontmostApplication.bundleIdentifier,
        ownerBundle.hasPrefix(frontmostBundle)
    {
        return PassiveActivity(
            appName: frontmostApplication.localizedName ?? "Passive Activity",
            bundleIdentifier: frontmostBundle
        )
    }

    return PassiveActivity(
        appName: owner.localizedName ?? "Passive Activity",
        bundleIdentifier: owner.bundleIdentifier ?? "unknown.passive"
    )
}

func currentObservation() -> Observation {
    let application = NSWorkspace.shared.runningApplications.first(where: \.isActive)
        ?? NSWorkspace.shared.frontmostApplication
    let idleSeconds = CGEventSource.secondsSinceLastEventType(
        .combinedSessionState,
        eventType: CGEventType(rawValue: UInt32.max)!
    )
    let passiveActivity = idleSeconds >= 120
        ? passiveActivityOwner(frontmostApplication: application)
        : nil

    return Observation(
        timestamp: Date(),
        appName: application?.localizedName ?? "Unknown",
        bundleIdentifier: application?.bundleIdentifier ?? "unknown",
        windowTitle: application.flatMap {
            focusedWindowTitle(processIdentifier: $0.processIdentifier)
        },
        idleSeconds: idleSeconds,
        passiveAppName: passiveActivity?.appName,
        passiveBundleIdentifier: passiveActivity?.bundleIdentifier
    )
}
