import AppKit
import Foundation
import ServiceManagement

@MainActor
final class ActivityModel: ObservableObject {
    static let shared = ActivityModel()

    @Published private(set) var isPaused = false
    @Published private(set) var lastObservation: Observation?
    @Published var launchAtLogin: Bool {
        didSet {
            guard !isSynchronizingLaunchAtLogin, launchAtLogin != oldValue else {
                return
            }
            updateLaunchAtLogin()
        }
    }

    private let store: ObservationStore
    private var accumulator: PeriodAccumulator
    private var timer: Timer?
    private var subscribers: [UUID: (String, String) -> Void] = [:]
    private let encoder: JSONEncoder
    private var isSynchronizingLaunchAtLogin = false

    private init() {
        do {
            store = try ObservationStore()
        } catch {
            fatalError("Unable to open the activity store: \(error)")
        }

        var accumulator = PeriodAccumulator()
        accumulator.rebuild(from: store.readAll())
        self.accumulator = accumulator
        launchAtLogin = SMAppService.mainApp.status == .enabled

        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.withoutEscapingSlashes]
    }

    var dataFileURL: URL {
        store.directoryURL
    }

    var accessibilityGranted: Bool {
        AXIsProcessTrusted()
    }

    func start() {
        guard timer == nil else { return }
        registerForLaunchAtLoginOnFirstRun()
        sample()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
            Task { @MainActor in
                ActivityModel.shared.sample()
            }
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func togglePaused() {
        isPaused.toggle()
    }

    func requestAccessibilityPermission() {
        let options = [
            "AXTrustedCheckOptionPrompt": true
        ] as CFDictionary
        AXIsProcessTrustedWithOptions(options)
    }

    func snapshotJSON() -> String {
        encode(
            ActivitySnapshot(
                dataFile: store.directoryURL.path,
                observationCount: accumulator.observationCount,
                periods: accumulator.periods
            )
        )
    }

    @discardableResult
    func subscribe(_ callback: @escaping (String, String) -> Void) -> UUID {
        let identifier = UUID()
        subscribers[identifier] = callback
        return identifier
    }

    func unsubscribe(_ identifier: UUID?) {
        guard let identifier else { return }
        subscribers.removeValue(forKey: identifier)
    }

    private func sample() {
        guard !isPaused else { return }
        let observation = currentObservation()

        do {
            try store.append(observation)
        } catch {
            NSLog("Unable to save activity observation: \(error)")
            return
        }

        lastObservation = observation
        let index = accumulator.add(observation)
        let change = PeriodChange(
            index: index,
            observationCount: accumulator.observationCount,
            period: accumulator.periods[index]
        )
        let json = encode(change)
        for callback in subscribers.values {
            callback("period", json)
        }
    }

    private func encode<T: Encodable>(_ value: T) -> String {
        guard
            let data = try? encoder.encode(value),
            let json = String(data: data, encoding: .utf8)
        else {
            return "{}"
        }
        return json
    }

    private func updateLaunchAtLogin() {
        do {
            if launchAtLogin {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            isSynchronizingLaunchAtLogin = true
            launchAtLogin = SMAppService.mainApp.status == .enabled
            isSynchronizingLaunchAtLogin = false
            NSLog("Unable to update launch-at-login: \(error)")
        }
    }

    private func registerForLaunchAtLoginOnFirstRun() {
        let defaultsKey = "hasConfiguredLaunchAtLogin"
        guard !UserDefaults.standard.bool(forKey: defaultsKey) else { return }
        UserDefaults.standard.set(true, forKey: defaultsKey)

        do {
            try SMAppService.mainApp.register()
            isSynchronizingLaunchAtLogin = true
            launchAtLogin = SMAppService.mainApp.status == .enabled
            isSynchronizingLaunchAtLogin = false
        } catch {
            isSynchronizingLaunchAtLogin = true
            launchAtLogin = SMAppService.mainApp.status == .enabled
            isSynchronizingLaunchAtLogin = false
            NSLog("Unable to register launch-at-login on first run: \(error)")
        }
    }
}
