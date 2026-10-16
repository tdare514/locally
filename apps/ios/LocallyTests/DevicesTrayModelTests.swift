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

    @Test("a record with no failure is ready; accepting makes it downloading")
    func readyAndDownloading() {
        let rows = DevicesTrayModel.rows(pending: [record("a"), record("b")], accepting: ["b"], failed: [], now: now)
        #expect(rows.map(\.state) == [.ready, .downloading])
        #expect(rows[0].canSend)
        #expect(!rows[1].canSend)
        #expect(rows[0].trackCount == 2)
    }

    @Test("a failed record is still sending, then waiting once an hour old")
    func stillSendingThenWaiting() {
        let pending = [record("fresh", age: 120), record("old", age: DevicesTrayModel.waitingAfter)]
        let rows = DevicesTrayModel.rows(pending: pending, accepting: [], failed: ["fresh", "old"], now: now)
        #expect(rows.map(\.state) == [.stillSending, .waiting])
        #expect(rows.allSatisfy { !$0.canSend })
    }

    @Test("a failed record being retried stays still sending, not downloading")
    func failedBeatsAccepting() {
        let rows = DevicesTrayModel.rows(pending: [record("a")], accepting: ["a"], failed: ["a"], now: now)
        #expect(rows.map(\.state) == [.stillSending])
    }

    @Test("rows that have not arrived sort last: still sending, then waiting")
    func sortsLast() {
        let pending = [record("w", age: 7200), record("s"), record("r1"), record("r2")]
        let rows = DevicesTrayModel.rows(pending: pending, accepting: [], failed: ["w", "s"], now: now)
        #expect(rows.map(\.id) == ["r1", "r2", "s", "w"])
    }

    @Test("the footer shows only while something is still sending, and follows the origin")
    func footer() {
        func footer(_ pending: [SyncRecord], failed: Set<String>) -> String? {
            DevicesTrayModel.footer(for: DevicesTrayModel.rows(pending: pending, accepting: [], failed: failed, now: now))
        }
        #expect(footer([record("a")], failed: []) == nil)
        #expect(footer([record("a", age: 7200)], failed: ["a"]) == nil)
        #expect(footer([record("a")], failed: ["a"]) == "Still sending this one from your Mac…")
        #expect(footer([record("a"), record("b")], failed: ["a", "b"]) == "Still sending these from your Mac…")
        #expect(footer([record("a", origin: "web")], failed: ["a"]) == "Still sending this one from that device…")
        #expect(footer([record("a"), record("b", origin: "web")], failed: ["a", "b"]) == "Still sending these…")
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

    @Test("copy: VoiceOver labels and the waiting wording")
    func copy() {
        #expect(Copy.Sync.trayButtonLabel(count: 3) == "From your devices, 3 waiting")
        #expect(Copy.Sync.trayClose == "Close")
        #expect(Copy.Sync.sendTitleToSpotify("Low Tide") == "Send Low Tide to Spotify")
        #expect(Copy.Sync.waitingOn(origin: "mac") == "Waiting on your Mac")
        #expect(Copy.Sync.audioNotArrived == "The audio hasn't arrived yet.")
    }
}
