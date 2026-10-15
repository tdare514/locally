import Testing
@testable import Locally

/// The "From your devices" tray copy (#185): each pending release carries a
/// small label saying where it came from. Matches the Mac's tray in apps/web.
struct SyncOriginCopyTests {
    @Test func theTrayIsTitledFromYourDevices() {
        #expect(Copy.Sync.fromYourDevices == "From your devices")
        #expect(Copy.Sync.pendingFromDevices(count: 1) == "1 song from your devices")
        #expect(Copy.Sync.pendingFromDevices(count: 3) == "3 songs from your devices")
    }

    @Test func labelsAReleaseByWhereItCameFrom() {
        #expect(Copy.Sync.originLabel("mac") == "from your Mac")
        #expect(Copy.Sync.originLabel("web") == "from the web")
    }

    @Test(arguments: ["future-thing", "android", "ios", ""])
    func saysAnotherDeviceForAnyOriginItHasNoNameFor(origin: String) {
        #expect(Copy.Sync.originLabel(origin) == "from another device")
    }
}
