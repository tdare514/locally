import Foundation
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

    // MARK: - isInside

    private var folder: URL {
        URL(fileURLWithPath: "/tmp/SpotifyFolder")
    }

    @Test func pathDirectlyInsideTheFolderIsInside() {
        #expect(layout.isInside(folder: folder, path: "/tmp/SpotifyFolder/song.mp3"))
    }

    @Test func pathElsewhereIsNotInside() {
        #expect(!layout.isInside(folder: folder, path: "/tmp/SomewhereElse/song.mp3"))
    }

    @Test func pathEscapingViaDotDotIsNotInside() {
        #expect(!layout.isInside(folder: folder, path: "/tmp/SpotifyFolder/../SomewhereElse/song.mp3"))
    }

    @Test func pathThatStartsWithTheFolderNameButIsASiblingIsNotInside() {
        // Guards a naive `hasPrefix` check: "SpotifyFolder2" is not inside "SpotifyFolder".
        #expect(!layout.isInside(folder: folder, path: "/tmp/SpotifyFolder2/song.mp3"))
    }

    @Test func theFolderItselfIsNotInside() {
        #expect(!layout.isInside(folder: folder, path: "/tmp/SpotifyFolder"))
    }

    // MARK: - isPlainFileName (sync record names)

    @Test func plainFileNamesFromBothPlatformsAreAccepted() {
        #expect(ReleaseLayout.isPlainFileName("01 - Intro.mp3"))
        #expect(ReleaseLayout.isPlainFileName("Chromatics - Night Drive - 01 - Intro.m4a"))
        #expect(ReleaseLayout.isPlainFileName("cover.jpg"))
        #expect(ReleaseLayout.isPlainFileName("Étude Nº 3 (live) [2024].mp3"))
        #expect(ReleaseLayout.isPlainFileName(String(repeating: "a", count: 255)))
    }

    @Test(arguments: [
        "../x.mp3", "..\\x.mp3", "a/b.mp3", "a\\b.mp3", "/etc/passwd", ".", "..", ".hidden.mp3", "",
        "bad\u{0}name.mp3", "bad\nname.mp3", String(repeating: "a", count: 256),
    ])
    func namesThatCouldLeaveTheDirectoryAreRefused(name: String) {
        #expect(!ReleaseLayout.isPlainFileName(name))
    }
}
