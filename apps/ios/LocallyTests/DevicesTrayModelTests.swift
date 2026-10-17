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
        #expect(Copy.Sync.readyToAdd == "Ready to add")
        #expect(Copy.Sync.couldntSendYet == "Couldn't send yet")
        #expect(Copy.Sync.couldntSendThese == "Locally couldn't send these yet.")
        #expect(Copy.Sync.addAll == "Add all" && Copy.Sync.adding == "Adding…")
        #expect(Copy.Sync.tryAllAgain == "Try all again" && Copy.Sync.trying == "Trying…")
        #expect(Copy.Sync.sectionHeading("Ready to add", count: 2) == "Ready to add, 2")
        #expect(Copy.Sync.tryTitleAgain("Low Tide") == "Try Low Tide again")
        #expect(Copy.Sync.failedHint == "Sending didn't finish. Try again.")
    }

    // MARK: Sections (#296)

    private func sections(_ pending: [SyncRecord], accepting: Set<String> = [], failed: Set<String> = []) -> DevicesTraySections {
        DevicesTraySections(rows: DevicesTrayModel.rows(pending: pending, accepting: accepting, failed: failed))
    }

    @Test("ready and failed rows land in their own sections, never both")
    func disjointSections() {
        let s = sections([record("a"), record("b"), record("c")], failed: ["b"])
        #expect(s.ready.map(\.id) == ["a", "c"])
        #expect(s.failed.map(\.id) == ["b"])
        #expect(Set(s.ready.map(\.id)).isDisjoint(with: s.failed.map(\.id)))
    }

    @Test("a row being sent stays in the section it was in")
    func sendingKeepsItsSection() {
        let s = sections([record("a"), record("b")], accepting: ["a", "b"], failed: ["b"])
        #expect(s.ready.map(\.id) == ["a"])
        #expect(s.failed.map(\.id) == ["b"])
        #expect(s.ready.first?.state == .sending && s.failed.first?.state == .sending)
    }

    @Test("Add all shows from two ready rows, and stays while its own run goes")
    func addAllVisibility() {
        #expect(!sections([record("a")]).showsAddAll(running: false))
        #expect(sections([record("a"), record("b")]).showsAddAll(running: false))
        // Both reserved by the run: none is addable now, but the button stays, reading "Adding…".
        let running = sections([record("a"), record("b")], accepting: ["a", "b"])
        #expect(running.addableCount == 0)
        #expect(!running.showsAddAll(running: false))
        #expect(running.showsAddAll(running: true))
    }

    @Test("Try all again shows whenever the second section does")
    func tryAllVisibility() {
        #expect(!sections([record("a")]).showsTryAllAgain)
        #expect(sections([record("a")], failed: ["a"]).showsTryAllAgain)
        #expect(sections([record("a"), record("b")], accepting: ["a"], failed: ["a", "b"]).retryableCount == 1)
    }

    @Test("a leaving row hands focus to the next row, else the previous, else a section action, else the heading")
    func focusAfterLeaving() {
        let before = sections([record("a"), record("b"), record("c")])
        let wo = { (gone: String) in sections([record("a"), record("b"), record("c")].filter { $0.id != gone }) }
        #expect(DevicesTraySections.focusAfterLeaving("a", before: before, after: wo("a"), addAllRunning: false) == .send("b"))
        #expect(DevicesTraySections.focusAfterLeaving("c", before: before, after: wo("c"), addAllRunning: false) == .send("b"))
        let two = sections([record("a"), record("b")])
        #expect(DevicesTraySections.focusAfterLeaving("a", before: two, after: sections([record("b")]), addAllRunning: false) == .send("b"))
        let failedOne = sections([record("f")], failed: ["f"])
        let mixed = sections([record("f"), record("g")], failed: ["f"])
        #expect(DevicesTraySections.focusAfterLeaving("g", before: mixed, after: failedOne, addAllRunning: false) == .send("f"))
        #expect(DevicesTraySections.focusAfterLeaving("f", before: failedOne, after: sections([]), addAllRunning: false) == .heading)
    }
}
