import Foundation
import Testing
@testable import Locally

@Suite struct LibraryViewPrefsTests {

    @Test func defaultsAreListAndLarge() {
        #expect(LibraryLayout.default == .list)
        #expect(CoverSize.default == .large)
        #expect(LibraryLayout(storedRaw: nil) == .list)
        #expect(CoverSize(storedRaw: nil) == .large)
    }

    @Test func unknownOrEmptyRawFallsBackToDefault() {
        #expect(LibraryLayout(storedRaw: "") == .list)
        #expect(LibraryLayout(storedRaw: "grid") == .list)
        #expect(CoverSize(storedRaw: -1) == .large)
        #expect(CoverSize(storedRaw: 3) == .large)
    }

    @Test func everyCaseRoundTrips() {
        for layout in LibraryLayout.allCases {
            #expect(LibraryLayout(storedRaw: layout.rawValue) == layout)
        }
        for size in CoverSize.allCases {
            #expect(CoverSize(storedRaw: size.rawValue) == size)
        }
    }

    @Test func artistsLayoutLoadsAndOldValuesStillDo() {
        #expect(LibraryLayout(storedRaw: "artists") == .artists)
        #expect(LibraryLayout(storedRaw: "list") == .list)
        #expect(LibraryLayout(storedRaw: "covers") == .covers)
        #expect(LibraryLayout.allCases == [.list, .covers, .artists])
    }

    @Test func tileMinWidthsIncreaseWithSize() {
        let widths = CoverSize.allCases.map(\.tileMinWidth)
        #expect(zip(widths, widths.dropFirst()).allSatisfy { $0 < $1 })
    }

    @Test func oldSizeChoiceMovesToTheNewKey() {
        #expect(LibraryViewPrefs.migratedCoverSize(newRaw: nil, legacyRaw: 0) == CoverSize.medium.rawValue)
        #expect(LibraryViewPrefs.migratedCoverSize(newRaw: nil, legacyRaw: 1) == CoverSize.large.rawValue)
        #expect(LibraryViewPrefs.migratedCoverSize(newRaw: nil, legacyRaw: 2) == CoverSize.large.rawValue)
        #expect(LibraryViewPrefs.migratedCoverSize(newRaw: nil, legacyRaw: nil) == nil)
        #expect(LibraryViewPrefs.migratedCoverSize(newRaw: 0, legacyRaw: 2) == 0)
    }

    @Test func migrationRunsOnceAndFreshInstallsGetTheDefault() throws {
        let suite = "LibraryViewPrefsTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        LibraryViewPrefs.migrateCoverSize(in: defaults)
        #expect(defaults.object(forKey: LibraryViewPrefs.coverSizeKey) == nil)

        defaults.set(0, forKey: LibraryViewPrefs.legacyCoverSizeKey)
        LibraryViewPrefs.migrateCoverSize(in: defaults)
        #expect(defaults.integer(forKey: LibraryViewPrefs.coverSizeKey) == CoverSize.medium.rawValue)

        // A later change on the new key is not overwritten by the old value.
        defaults.set(CoverSize.small.rawValue, forKey: LibraryViewPrefs.coverSizeKey)
        LibraryViewPrefs.migrateCoverSize(in: defaults)
        #expect(defaults.integer(forKey: LibraryViewPrefs.coverSizeKey) == CoverSize.small.rawValue)
    }

    @Test func smallShowsFiveAcrossOnAPhoneAndTitleOnly() {
        let width: CGFloat = 390 - 2 * Theme.Spacing.listPagePadding
        let size = CoverSize.small
        #expect(Int((width + size.tileGap) / (size.tileMinWidth + size.tileGap)) >= 5)
        #expect(!size.showsSubtitle)
        #expect(CoverSize.medium.showsSubtitle && CoverSize.large.showsSubtitle)
    }

    @Test func sliderPositionSnapsToTheNearestDetentAndClamps() {
        #expect(CoverSize.nearest(fraction: 0) == .small)
        #expect(CoverSize.nearest(fraction: 0.24) == .small)
        #expect(CoverSize.nearest(fraction: 0.26) == .medium)
        #expect(CoverSize.nearest(fraction: 0.5) == .medium)
        #expect(CoverSize.nearest(fraction: 0.74) == .medium)
        #expect(CoverSize.nearest(fraction: 0.76) == .large)
        #expect(CoverSize.nearest(fraction: 1) == .large)
        #expect(CoverSize.nearest(fraction: -3) == .small)
        #expect(CoverSize.nearest(fraction: 7) == .large)
    }

    @Test func gridSizeStepsUpAtAccessibilitySizes() {
        #expect(CoverSize.small.forGrid(.large) == .small)
        #expect(CoverSize.small.forGrid(.xxxLarge) == .small)
        #expect(CoverSize.medium.forGrid(.accessibility2) == .medium)
        #expect(CoverSize.small.forGrid(.accessibility1) == .medium)
        #expect(CoverSize.small.forGrid(.accessibility2) == .medium)
        #expect(CoverSize.small.forGrid(.accessibility3) == .large)
        #expect(CoverSize.medium.forGrid(.accessibility3) == .large)
        #expect(CoverSize.medium.forGrid(.accessibility5) == .large)
        #expect(CoverSize.large.forGrid(.accessibility5) == .large)
    }

    @Test func voiceOverSteppingStopsAtTheEnds() {
        #expect(CoverSize.small.stepped(by: 1) == .medium)
        #expect(CoverSize.medium.stepped(by: 1) == .large)
        #expect(CoverSize.large.stepped(by: 1) == .large)
        #expect(CoverSize.large.stepped(by: -1) == .medium)
        #expect(CoverSize.small.stepped(by: -1) == .small)
    }
}
