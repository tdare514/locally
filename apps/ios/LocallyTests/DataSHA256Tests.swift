import Foundation
import Testing
@testable import Locally

struct DataSHA256Tests {

    @Test func emptyDataHashesToTheKnownVector() {
        #expect(Data().sha256Hex == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    @Test func abcHashesToTheKnownVector() {
        #expect(Data("abc".utf8).sha256Hex == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    @Test func outputIsSixtyFourLowercaseHexCharacters() {
        // 0xff bytes exercise the high nibbles, where an uppercase or
        // unpadded format would show up.
        let hex = Data(repeating: 0xff, count: 100).sha256Hex
        #expect(hex.count == 64)
        #expect(hex.allSatisfy { "0123456789abcdef".contains($0) })
    }

    @Test func hashIsOverRawBytesNotTextEncoding() {
        // The Mac hashes the raw file bytes (SyncEngine.ts sha256File); a
        // non-UTF-8 byte sequence must hash deterministically and differ
        // from a nearby input.
        let a = Data([0x00, 0x80, 0xff]).sha256Hex
        let b = Data([0x00, 0x80, 0xfe]).sha256Hex
        #expect(a != b)
        #expect(a == Data([0x00, 0x80, 0xff]).sha256Hex)
    }
}
