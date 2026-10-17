import Testing
@testable import Locally

@Suite("Release view mode (#296)")
struct ReleaseViewModeTests {
    @Test("a track's second line at accessibility sizes is plays and time as one line")
    func playsAndTimeLine() {
        #expect(TrackRowLine.playsAndTime(plays: 35, time: "2:22") == "35 plays, 2:22")
        #expect(TrackRowLine.playsAndTime(plays: 1, time: "0:59") == "1 play, 0:59")
        #expect(TrackRowLine.playsAndTime(plays: nil, time: "2:22") == "2:22")
        #expect(TrackRowLine.playsAndTime(plays: 12, time: nil) == "12 plays")
        #expect(TrackRowLine.playsAndTime(plays: nil, time: nil) == nil)
    }

    @Test("the details meta line")
    func metaLine() {
        #expect(Copy.Detail.metaLine(kind: "Album", tracks: 5) == "Album · 5 tracks")
        #expect(Copy.Detail.metaLine(kind: "Single", tracks: 1) == "Single · 1 track")
    }

    @Test("the no-cover note is about a third of a large sleeve and larger on small ones")
    func glyphRatio() {
        #expect(abs(NoCoverArt.glyphRatio(forSide: 200) - 1.0 / 3) < 0.0001)
        #expect(NoCoverArt.glyphRatio(forSide: 48) == 0.45)
        let mid = NoCoverArt.glyphRatio(forSide: 90)
        #expect(mid < 0.45 && mid > 1.0 / 3)
    }
}
