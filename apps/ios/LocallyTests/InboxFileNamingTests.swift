import Foundation
import Testing
@testable import Locally

struct InboxFileNamingTests {
    @Test func fileNamePrefixesTheOriginalNameWithTheUUID() {
        let id = UUID()
        let name = InboxFileNaming.fileName(id: id, originalName: "song.mp3")
        #expect(name == "\(id.uuidString)-song.mp3")
    }

    @Test func originalNameRoundTripsThroughFileName() {
        let id = UUID()
        let name = InboxFileNaming.fileName(id: id, originalName: "My Song.m4a")
        #expect(InboxFileNaming.originalName(fromInboxFileName: name) == "My Song.m4a")
    }

    @Test func originalNameHandlesAnOriginalNameThatItselfContainsADash() {
        let id = UUID()
        let name = InboxFileNaming.fileName(id: id, originalName: "not-so-simple-title.mp3")
        #expect(InboxFileNaming.originalName(fromInboxFileName: name) == "not-so-simple-title.mp3")
    }

    @Test func originalNameReturnsNilWithoutAnyDash() {
        #expect(InboxFileNaming.originalName(fromInboxFileName: "song.mp3") == nil)
    }

    @Test func originalNameReturnsNilWhenThePrefixIsNotAUUID() {
        #expect(InboxFileNaming.originalName(fromInboxFileName: "not-a-uuid-song.mp3") == nil)
    }

    @Test func originalNameReturnsNilWhenNothingFollowsTheDash() {
        let id = UUID()
        #expect(InboxFileNaming.originalName(fromInboxFileName: "\(id.uuidString)-") == nil)
    }

    @Test func fileNameKeepsALongNameWithinTheFileSystemLimit() {
        let id = UUID()
        let original = String(repeating: "a", count: 300) + ".flac"
        let name = InboxFileNaming.fileName(id: id, originalName: original)
        #expect(name.utf8.count == InboxFileNaming.maxFileNameBytes)
        #expect(name.hasPrefix("\(id.uuidString)-aaa"))
        #expect(name.hasSuffix(".flac"))
        let recovered = InboxFileNaming.originalName(fromInboxFileName: name)
        #expect(recovered.map(SupportedAudio.isSupported(fileName:)) == true)
    }

    @Test func fileNameTruncatesMultiByteNamesOnACharacterBoundary() {
        let original = String(repeating: "é", count: 200) + ".mp3"
        let name = InboxFileNaming.fileName(id: UUID(), originalName: original)
        #expect(name.utf8.count <= InboxFileNaming.maxFileNameBytes)
        #expect(name.hasSuffix("é.mp3"))
    }

    @Test func fileNameLeavesANameThatFitsUntouched() {
        let id = UUID()
        let original = String(repeating: "b", count: 214) + ".mp3"
        #expect(InboxFileNaming.fileName(id: id, originalName: original) == "\(id.uuidString)-\(original)")
    }
}
