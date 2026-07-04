import AppKit
import SwiftUI

@main
struct ActivityProbeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = ActivityModel.shared

    var body: some Scene {
        MenuBarExtra(
            "Activity Probe",
            systemImage: model.isPaused ? "pause.circle.fill" : "clock.arrow.circlepath"
        ) {
            ActivityMenu(model: model)
        }

        Settings {
            ActivitySettings(model: model)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        ActivityModel.shared.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(
        _ sender: NSApplication
    ) -> Bool {
        false
    }

    func applicationWillTerminate(_ notification: Notification) {
        WebDashboardServer.shared.stop()
    }
}

struct ActivityMenu: View {
    @ObservedObject var model: ActivityModel

    var body: some View {
        if let observation = model.lastObservation {
            VStack(alignment: .leading, spacing: 2) {
                Text(model.isPaused ? "Tracking paused" : observation.appName)
                    .font(.headline)
                if let title = observation.windowTitle, !title.isEmpty {
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 3)
        } else {
            Text(model.isPaused ? "Tracking paused" : "Waiting for activity…")
        }

        Divider()

        Button("Open Timeline") {
            WebDashboardServer.shared.openTimeline()
        }
        .keyboardShortcut("o")

        Button(model.isPaused ? "Resume Tracking" : "Pause Tracking") {
            model.togglePaused()
        }

        Button("Open Data File") {
            NSWorkspace.shared.activateFileViewerSelecting([model.dataFileURL])
        }

        Button(APIKeyStore.hasOpenAIKey ? "OpenAI API Key… ✓" : "OpenAI API Key…") {
            APIKeyWindowController.shared.show()
        }

        Divider()

        Button("Settings…") {
            NSApplication.shared.sendAction(
                Selector(("showSettingsWindow:")),
                to: nil,
                from: nil
            )
        }

        Button("Quit Activity Probe") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q")
    }
}

@MainActor
final class APIKeyWindowController {
    static let shared = APIKeyWindowController()

    private init() {}

    func show() {
        let field = NSSecureTextField(
            frame: NSRect(x: 0, y: 0, width: 360, height: 24)
        )
        field.placeholderString = APIKeyStore.hasOpenAIKey
            ? "A key is already saved; enter a replacement"
            : "sk-…"

        let alert = NSAlert()
        alert.messageText = "OpenAI API Key"
        alert.informativeText =
            "The key is stored in macOS Keychain and passed only to the " +
            "local dashboard server. Leave the field empty to remove it."
        alert.accessoryView = field
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")

        guard alert.runModal() == .alertFirstButtonReturn else { return }

        do {
            try APIKeyStore.saveOpenAIKey(field.stringValue)
            WebDashboardServer.shared.configurationDidChange()
        } catch {
            let errorAlert = NSAlert(error: error)
            errorAlert.runModal()
        }
    }
}

struct ActivitySettings: View {
    @ObservedObject var model: ActivityModel

    var body: some View {
        Form {
            Toggle(
                "Launch Activity Probe when I log in",
                isOn: Binding(
                    get: { model.launchAtLogin },
                    set: { model.launchAtLogin = $0 }
                )
            )

            LabeledContent("Activity data") {
                Text(model.dataFileURL.path)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            LabeledContent("Window titles") {
                if model.accessibilityGranted {
                    Label("Enabled", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                } else {
                    Button("Grant Accessibility Access") {
                        model.requestAccessibilityPermission()
                    }
                }
            }

            Text(
                "Activity remains on this Mac. The app does not record " +
                "keystrokes, clipboard contents, or screenshots."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .formStyle(.grouped)
        .frame(width: 540, height: 260)
    }
}
