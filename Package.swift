// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ActivityProbe",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "activity-probe",
            path: "Sources/ActivityProbe"
        )
    ]
)
