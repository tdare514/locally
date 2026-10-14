import Foundation
import Testing
@testable import Locally

@Suite struct LibraryViewPrefsTests {

    @Test func defaultsAreListAndMedium() {
        #expect(LibraryLayout.default == .list)
        #expect(CoverSize.default == .medium)
        #expect(LibraryLayout(storedRaw: nil) == .list)
        #expect(CoverSize(storedRaw: nil) == .medium)
    }

    @Test func unknownOrEmptyRawFallsBackToDefault() {
        #expect(LibraryLayout(storedRaw: "") == .list)
        #expect(LibraryLayout(storedRaw: "grid") == .list)
        #expect(CoverSize(storedRaw: -1) == .medium)
        #expect(CoverSize(storedRaw: 3) == .medium)
    }

    @Test func everyCaseRoundTrips() {
        for layout in LibraryLayout.allCases {
            #expect(LibraryLayout(storedRaw: layout.rawValue) == layout)
        }
        for size in CoverSize.allCases {
            #expect(CoverSize(storedRaw: size.rawValue) == size)
        }
    }

    @Test func tileMinWidthsIncreaseWithSize() {
        let widths = CoverSize.allCases.map(\.tileMinWidth)
        #expect(zip(widths, widths.dropFirst()).allSatisfy { $0 < $1 })
    }
}
