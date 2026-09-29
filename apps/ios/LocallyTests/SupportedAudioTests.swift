import Foundation
import Testing
@testable import Locally

struct SupportedAudioTests {
    @Test func acceptsSupportedExtensions() {
        for name in ["song.mp3", "song.m4a", "song.wav", "song.flac", "song.aiff", "song.aif"] {
            #expect(SupportedAudio.isSupported(fileName: name))
        }
    }

    @Test func acceptsCaseInsensitiveExtensions() {
        #expect(SupportedAudio.isSupported(fileName: "SONG.MP3"))
        #expect(SupportedAudio.isSupported(fileName: "Song.Flac"))
    }

    @Test func rejectsUnsupportedExtensions() {
        for name in ["song.ogg", "song.opus", "song.aac", "song.caf", "song.mp4", "cover.jpg", "notes.txt"] {
            #expect(!SupportedAudio.isSupported(fileName: name))
        }
    }

    @Test func rejectsMissingOrEmptyExtension() {
        #expect(!SupportedAudio.isSupported(fileName: "song"))
        #expect(!SupportedAudio.isSupported(fileName: "song."))
    }

    @Test func readableListCoversEveryExtensionExceptAif() {
        for ext in SupportedAudio.extensions where ext != "aif" {
            #expect(SupportedAudio.readableList.contains(ext))
        }
        // Tokenize: "aiff" contains the substring "aif", so a raw
        // `contains("aif")` would falsely fail on the intended "aiff".
        let tokens = SupportedAudio.readableList
            .replacingOccurrences(of: " or ", with: ", ")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
        #expect(!tokens.contains("aif"))
    }
}
