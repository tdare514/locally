import Foundation
import Testing
@testable import Locally

@Suite struct TrackLengthTests {

    @Test func formatsMinutesAndSeconds() {
        #expect(TrackLength.format(7) == "0:07")
        #expect(TrackLength.format(204) == "3:24")
        #expect(TrackLength.format(3599) == "59:59")
    }

    @Test func formatsHoursFromOneHour() {
        #expect(TrackLength.format(3600) == "1:00:00")
        #expect(TrackLength.format(3725) == "1:02:05")
    }

    @Test func unknownLengthsGiveNil() {
        #expect(TrackLength.format(nil) == nil)
        #expect(TrackLength.format(.nan) == nil)
        #expect(TrackLength.format(.infinity) == nil)
        #expect(TrackLength.format(0) == nil)
        #expect(TrackLength.format(-5) == nil)
    }

    @Test func spokenLengthUsesWords() {
        let spoken = TrackLength.spoken(204)
        #expect(spoken?.contains("minute") == true)
        #expect(spoken?.contains("second") == true)
        #expect(TrackLength.spoken(nil) == nil)
    }
}
