import Foundation
import Testing
@testable import Locally

struct SpotifyFolderTests {
    @Test func disconnectedReportsNotConnected() {
        let defaults = UserDefaults(suiteName: "SpotifyFolderTests.\(UUID().uuidString)")!
        let folder = UserDefaultsSpotifyFolder(defaults: defaults)
        #expect(folder.isConnected == false)
    }

    @Test func connectMakesItConnected() throws {
        let defaults = UserDefaults(suiteName: "SpotifyFolderTests.\(UUID().uuidString)")!
        let folder = UserDefaultsSpotifyFolder(defaults: defaults)

        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        try folder.connect(url: dir)
        #expect(folder.isConnected == true)
    }

    @Test func bookmarkRoundTripsToTheSameTempDirectory() throws {
        let defaults = UserDefaults(suiteName: "SpotifyFolderTests.\(UUID().uuidString)")!
        let folder = UserDefaultsSpotifyFolder(defaults: defaults)

        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let marker = dir.appendingPathComponent("marker.txt")
        try "hello".data(using: .utf8)!.write(to: marker)

        try folder.connect(url: dir)

        let resolvedPath: String = try folder.withAccess { resolvedURL in
            resolvedURL.path
        }

        #expect(resolvedPath == dir.resolvingSymlinksInPath().path || resolvedPath == dir.path)
        #expect(FileManager.default.fileExists(atPath: marker.path))
    }

    @Test func disconnectRemovesTheBookmark() throws {
        let defaults = UserDefaults(suiteName: "SpotifyFolderTests.\(UUID().uuidString)")!
        let folder = UserDefaultsSpotifyFolder(defaults: defaults)

        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try folder.connect(url: dir)
        #expect(folder.isConnected == true)

        folder.disconnect()
        #expect(folder.isConnected == false)
    }

    @Test func withAccessThrowsWhenNeverConnected() {
        let defaults = UserDefaults(suiteName: "SpotifyFolderTests.\(UUID().uuidString)")!
        let folder = UserDefaultsSpotifyFolder(defaults: defaults)

        #expect(throws: LocallyError.self) {
            try folder.withAccess { _ in () }
        }
    }
}
