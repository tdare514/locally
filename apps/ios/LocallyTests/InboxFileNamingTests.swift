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
}
