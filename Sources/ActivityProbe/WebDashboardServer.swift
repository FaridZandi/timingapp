import AppKit
import Foundation

@MainActor
final class WebDashboardServer {
    static let shared = WebDashboardServer()

    private let dashboardURL = URL(string: "http://127.0.0.1:8765")!
    private var process: Process?

    private init() {}

    func openTimeline() {
        if process?.isRunning != true {
            start()
        }

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

    private func start() {
        guard let scriptURL = serverScriptURL() else {
            showError("The bundled dashboard server could not be found.")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = [scriptURL.path]
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
