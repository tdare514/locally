import Foundation
import Testing
@testable import Locally

struct FileCoverStoreTests {
    private func makeStore() -> (FileCoverStore, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return (FileCoverStore(directory: dir), dir)
    }

    private var pngBytes: Data {
        Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3])
    }

    private var jpegBytes: Data {
        Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
    }

    @Test func savesAndLoadsARoundTrip() throws {
        let (store, _) = makeStore()
        let id = UUID()

        _ = try store.save(jpegBytes, for: id)

        #expect(store.load(id) == jpegBytes)
    }

    @Test func savingChoosesExtensionByMagicBytesNotContent() throws {
        let (store, dir) = makeStore()
        let id = UUID()

        let path = try store.save(pngBytes, for: id)

        #expect(path.hasSuffix(".png"))
        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("\(id.uuidString).png").path))
    }

    @Test func jpegBytesGetAJpgExtension() throws {
        let (store, dir) = makeStore()
        let id = UUID()

        let path = try store.save(jpegBytes, for: id)

        #expect(path.hasSuffix(".jpg"))
        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("\(id.uuidString).jpg").path))
    }

    @Test func deleteRemovesTheFileAndLoadReturnsNil() throws {
        let (store, _) = makeStore()
        let id = UUID()
        _ = try store.save(jpegBytes, for: id)
        #expect(store.load(id) != nil)

        try store.delete(id)

        #expect(store.load(id) == nil)
    }

    @Test func loadingAnUnknownIdReturnsNil() {
        let (store, _) = makeStore()
        #expect(store.load(UUID()) == nil)
    }

    @Test func savingTwiceForTheSameIdReplacesTheFirstFile() throws {
        let (store, dir) = makeStore()
        let id = UUID()

        _ = try store.save(jpegBytes, for: id)
        let secondPath = try store.save(pngBytes, for: id)

        #expect(secondPath.hasSuffix(".png"))
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("\(id.uuidString).jpg").path))
        #expect(store.load(id) == pngBytes)
    }

    @Test func deletingAnUnknownIdDoesNotThrow() throws {
        let (store, _) = makeStore()
        try store.delete(UUID())
    }
}
