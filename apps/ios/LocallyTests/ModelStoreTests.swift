import Foundation
import SwiftData
import Testing
@testable import Locally

struct ModelStoreTests {
    private func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ModelStoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test func openingAFreshStoreSucceeds() throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        _ = try ModelStore.open(at: dir.appendingPathComponent("x.store"))
    }

    @Test func moveAsideKeepsTheStoreFilesAndLetsAFreshOneOpen() throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = dir.appendingPathComponent("x.store")
        let garbage = Data("not a sqlite database".utf8)
        try garbage.write(to: store)
        try garbage.write(to: dir.appendingPathComponent("x.store-wal"))

        let backup = try ModelStore.moveAside(storeAt: store)

        #expect(backup.deletingLastPathComponent().standardizedFileURL == dir.standardizedFileURL)
        #expect(backup.lastPathComponent.hasPrefix("Locally-store-backup-"))
        #expect(!FileManager.default.fileExists(atPath: store.path))
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("x.store-wal").path))
        #expect(try Data(contentsOf: backup.appendingPathComponent("x.store")) == garbage)
        #expect(try Data(contentsOf: backup.appendingPathComponent("x.store-wal")) == garbage)
        #expect(!FileManager.default.fileExists(atPath: backup.appendingPathComponent("x.store-shm").path))
        _ = try ModelStore.open(at: store)
    }

    @Test func openingACorruptStoreThrowsInsteadOfCrashing() throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = dir.appendingPathComponent("x.store")
        try Data(repeating: 0xAB, count: 4096).write(to: store)

        #expect(throws: (any Error).self) { _ = try ModelStore.open(at: store) }
    }
}
