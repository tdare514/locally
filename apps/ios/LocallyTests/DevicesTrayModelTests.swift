import Foundation
import Testing
@testable import Locally

@Suite("DevicesTrayModel (#269)")
struct DevicesTrayModelTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func record(_ id: String, origin: String = "mac", age: TimeInterval = 60, tracks: Int = 2) -> SyncRecord {
        SyncRecord(
            id: id, kind: "album", title: "Title \(id)", artist: "Artist",
            tracks: (0..<tracks).map { SyncTrack(id: "\(id)-\($0)", title: "T\($0)", trackNumber: $0 + 1, file: "\($0).m4a", bytes: 0, durationSec: nil) },
            origin: origin, originDevice: "Device",
            createdAt: now.addingTimeInterval(-age), updatedAt: now.addingTimeInterval(-age)
        )
    }

    @Test("a record with no failure is ready; a running send is sending")
    func readyAndSending() {
        let rows = DevicesTrayModel.rows(pending: [record("a"), record("b")], accepting: ["b"], failed: [])
        #expect(rows.map(\.state) == [.ready, .sending])
        #expect(rows[0].canSend)
        #expect(!rows[1].canSend)
        #expect(rows[0].trackCount == 2)
    }

    @Test("a failed accept is a generic failure that can be retried, however old the record")
    func failedIsGeneric() {
        let rows = DevicesTrayModel.rows(pending: [record("fresh", age: 120), record("old", age: 7200)], accepting: [], failed: ["fresh", "old"])
        #expect(rows.map(\.state) == [.failed, .failed])
        #expect(rows.allSatisfy { $0.canSend })
    }

    @Test("a send in progress wins over an earlier failure")
    func sendingBeatsFailed() {
        let rows = DevicesTrayModel.rows(pending: [record("a")], accepting: ["a"], failed: ["a"])
        #expect(rows.map(\.state) == [.sending])
        #expect(!rows[0].canSend)
    }

    @Test("rows keep their sync order whatever their state")
    func keepsOrder() {
        let rows = DevicesTrayModel.rows(pending: [record("f"), record("s"), record("r")], accepting: ["s"], failed: ["f"])
        #expect(rows.map(\.id) == ["f", "s", "r"])
    }

    @Test("open and close; an empty tray closes itself")
    func openClose() {
        var model = DevicesTrayModel()
        #expect(!model.isOpen)
        model.toggle()
        #expect(model.isOpen)
        model.pendingCountChanged(to: 2)
        #expect(model.isOpen)
        model.close()
        #expect(!model.isOpen)
        model.toggle()
        model.pendingCountChanged(to: 0)
        #expect(!model.isOpen)
    }

    @Test("the badge shows only while something is pending and the tray is closed")
    func badge() {
        #expect(DevicesTrayModel.showsBadge(count: 3, isOpen: false))
        #expect(!DevicesTrayModel.showsBadge(count: 3, isOpen: true))
        #expect(!DevicesTrayModel.showsBadge(count: 0, isOpen: false))
    }

    @Test("copy: VoiceOver labels and the failure wording")
    func copy() {
        #expect(Copy.Sync.trayButtonLabel(count: 3) == "From your devices, 3 waiting")
        #expect(Copy.Sync.trayClose == "Close")
        #expect(Copy.Sync.sendTitleToSpotify("Low Tide") == "Send Low Tide to Spotify")
        #expect(Copy.Sync.couldntSend == "Couldn't send this yet.")
        #expect(Copy.Sync.tryAgain == "Try again")
        #expect(Copy.Sync.failedHint == "Sending didn't finish. Try again.")
    }
}
