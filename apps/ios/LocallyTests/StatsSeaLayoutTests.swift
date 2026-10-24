import Foundation
import Testing
@testable import Locally

/// The Stats grid is one size (#361): the first value of the Mac's table.
struct StatsSeaLayoutTests {
    @Test func firstValueGivesThreeAcrossOnAPhone() {
        #expect(StatsSeaLayout.columns(forWidth: 358)[0] == 3)
        // A 320 pt phone has 288 pt of room: two across, by the Mac's table.
        #expect(StatsSeaLayout.columns(forWidth: 288)[0] == 2)
    }

    @Test func narrowRoomStillFitsATile() {
        let cols = StatsSeaLayout.columns(forWidth: 200)[0]
        #expect(cols == 2)
        #expect((200 - CGFloat(cols - 1) * Theme.Stats.tileGap) / CGFloat(cols) >= Theme.Stats.tileMin)
    }
}
