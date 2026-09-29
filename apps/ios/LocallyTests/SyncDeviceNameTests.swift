import Foundation
import Testing
@testable import Locally

struct SyncDeviceNameTests {
    @Test func mapsKnownIdentifiers() {
        #expect(SyncDeviceName.name(forMachine: "iPhone14,7") == "iPhone 14")
        #expect(SyncDeviceName.name(forMachine: "iPhone17,5") == "iPhone 16e")
        #expect(SyncDeviceName.name(forMachine: "iPhone18,3") == "iPhone 17")
        #expect(SyncDeviceName.name(forMachine: "iPhone18,4") == "iPhone Air")
    }

    @Test func unknownIdentifierFallsBackToRawValue() {
        #expect(SyncDeviceName.name(forMachine: "iPhone99,9") == "iPhone99,9")
    }

    @Test func emptyOrWhitespaceBecomesIPhone() {
        #expect(SyncDeviceName.name(forMachine: "  ") == "iPhone")
        #expect(SyncDeviceName.name(forMachine: "") == "iPhone")
    }

    @Test func truncatesToTwoHundredCharacters() {
        let long = String(repeating: "x", count: 300)
        let result = SyncDeviceName.name(forMachine: long)
        #expect(result.count == 200)
    }

    @Test func everyResultIsWithinApiLengthBounds() {
        let samples = ["iPhone14,7", "iPhone99,9", "  ", "", String(repeating: "a", count: 300)]
        for sample in samples {
            let name = SyncDeviceName.name(forMachine: sample)
            #expect((1 ... 200).contains(name.count))
        }
    }
}

@MainActor
struct SyncDeviceNameContainerTests {
    @Test func aContainerBuiltOverASignedInStoreExposesTheDeviceNameTheSettingsRowBindsTo() {
        let folderDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let folder = FakeSpotifyFolder(directory: folderDir)
        let library = InMemoryLibraryStore()
        let account = InMemorySyncAccountStore()
        account.save(email: "toby@example.com", deviceToken: "test-token", deviceId: "device-1")
        account.deviceName = "iPhone 14"
        let api = FakeSyncApi()
        let container = AppContainer.forTesting(
            folder: folder,
            library: library,
            importer: FakeFileImporter(),
            transcoder: FakeTranscoder(),
            m4aTagWriter: FakeTagWriter(),
            id3TagWriter: FakeTagWriter(),
            coverStore: FakeCoverStore(),
            inbox: FakeInboxStore(),
            purchase: FakePurchaseService(),
            syncAccount: account,
            syncApi: api,
            outbox: InMemorySyncOutbox()
        )
        #expect(container.syncStatus.deviceName == "iPhone 14")
        #expect(container.syncStatus.signedIn)
        #expect(api.meCallCount == 0)
    }
}
