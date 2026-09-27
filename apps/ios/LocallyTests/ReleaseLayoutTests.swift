import Testing
@testable import Locally

struct ReleaseLayoutTests {
    let layout = ReleaseLayout()

    @Test func sanitizesIllegalCharacters() {
        #expect(layout.sanitizeSegment("A/B:C*D?E\"F<G>H|I") == "ABCDEFGHI")
    }

    @Test func trimsTrailingDotsAndSpaces() {
        #expect(layout.sanitizeSegment("Trailing... ") == "Trailing")
    }

    @Test func fallsBackToUnknownWhenEmpty() {
        #expect(layout.sanitizeSegment("") == "Unknown")
        #expect(layout.sanitizeSegment(nil) == "Unknown")
        #expect(layout.sanitizeSegment("   ") == "Unknown")
        #expect(layout.sanitizeSegment("...") == "Unknown")
    }

    @Test func padsSingleDigitTrackNumbers() {
        let name = layout.fileName(artist: "Artist", album: "Album", trackNumber: 3, title: "Title", ext: "mp3")
        #expect(name == "Artist - Album - 03 - Title.mp3")
    }

    @Test func doesNotPadDoubleDigitTrackNumbers() {
        let name = layout.fileName(artist: "Artist", album: "Album", trackNumber: 12, title: "Title", ext: "m4a")
        #expect(name == "Artist - Album - 12 - Title.m4a")
    }

    @Test func fullFileNameSanitizesEverySegment() {
        let name = layout.fileName(artist: "A/rtist", album: "Al:bum", trackNumber: 1, title: "Ti*tle", ext: "mp3")
        #expect(name == "Artist - Album - 01 - Title.mp3")
    }
}
