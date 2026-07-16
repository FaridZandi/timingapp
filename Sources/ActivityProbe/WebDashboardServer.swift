import AppKit
import Foundation

@MainActor
final class WebDashboardServer {
    static let shared = WebDashboardServer()

    private let dashboardURL = URL(string: "http://127.0.0.1:8765")!
    private var process: Process?

    private init() {}

    func startIfNeeded() {
        guard process?.isRunning != true else { return }
        start()
    }

    func openTimeline() {
        startIfNeeded()

        // Give a newly launched server a brief moment to bind its port.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [dashboardURL] in
            NSWorkspace.shared.open(dashboardURL)
        }
    }

    func stop() {
        guard let process, process.isRunning else { return }
        process.terminate()
        self.process = nil
    }

    func configurationDidChange() {
        guard process?.isRunning == true else { return }
        stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.start()
        }
    }

    private func start() {
        guard let scriptURL = serverScriptURL() else {
            showError("The bundled dashboard server could not be found.")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = [scriptURL.path]
        var environment = ProcessInfo.processInfo.environment
        if let key = APIKeyStore.openAIKey() {
            environment["OPENAI_API_KEY"] = key
        } else {
            environment.removeValue(forKey: "OPENAI_API_KEY")
        }
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            self.process = process
        } catch {
            showError("The dashboard server could not start: \(error.localizedDescription)")
        }
    }

    private func serverScriptURL() -> URL? {
        if let bundled = Bundle.main.url(
            forResource: "server",
            withExtension: "py",
            subdirectory: "Dashboard"
        ) {
            return bundled
        }

        let development = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("dashboard/server.py")
        return FileManager.default.fileExists(atPath: development.path)
            ? development
            : nil
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Unable to Open Timeline"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }
}
