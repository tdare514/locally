import Foundation
import Testing
@testable import Locally

/// The song page's data (#365): every field, the disc and track counts, adopted vs phone, the format and size
/// text, the collections that hold a track and the plays. Typed expected values keep CI's type-checker quick.
struct SongPageModelTests {
    private static let releaseID = UUID(uuidString: "00000000-0000-0000-0000-0000000000a1")!
    private static let trackID = UUID(uuidString: "00000000-0000-0000-0000-0000000000b3")!
    private static let en = Locale(identifier: "en_GB")

    private static func release(adopted: Bool = false, tracks: Int = 10, discs: Bool = true, length: Double? = 204) -> Release {
        var list: [Track] = []
        for n in 1...tracks {
            let id = n == 3 ? trackID : UUID()
            let disc: Int? = discs ? (n <= tracks / 2 ? 1 : 2) : nil
            let title = n == 3 ? "Paper Moon (feat. Okoro)" : "Song \(n)"
            list.append(Track(id: id, title: title, trackNumber: n, discNumber: disc, filePath: adopted ? "" : "/folder/Locally/03 Paper Moon.m4a",
                              originalName: adopted ? "Paper Moon.mp3" : "03 Paper Moon.m4a", durationSec: n == 3 ? length : 100))
        }
        return Release(id: releaseID, kind: .album, title: "Night Bus to Nowhere", artist: "Mira Valdane feat. Juniper Hale",
                       year: "2025", releaseDate: "2025-03-14", genre: "Indie pop", folderPath: "/folder", tracks: list,
                       source: adopted ? .adopted : nil)
    }

    private static func model(_ release: Release, plays: SongPlays? = nil, collections: [MusicCollection] = [], readLength: Double? = nil, fileSize: Int64? = nil, today: String = "2025-10-24") -> SongPageModel {
        SongPageModel(release: release, trackID: trackID, plays: plays, collections: collections, readLength: readLength, fileSize: fileSize, today: today, locale: en)!
    }

    private static func collection(_ name: String, _ items: [CollectionItem]) -> MusicCollection {
        MusicCollection(id: UUID(), name: name, items: items, origin: "ios", originDevice: "Test", createdAt: Date(), updatedAt: Date())
    }

    // MARK: Fields

    @Test func everyFieldComesFromTheReleaseAndTrack() {
        let model = Self.model(Self.release(), fileSize: 8_400_000)
        let title: String = "Paper Moon"
        let artist: String = "Mira Valdane"
        let featuring: [String] = ["Okoro", "Juniper Hale"]
        let album: String = "Night Bus to Nowhere"
        let released: String = "14 March 2025"
        let length: String = "3:24"
        let fileName: String = "03 Paper Moon.m4a"
        let format: String = "AAC (m4a)"
        let size: String = "8.4 MB"
        #expect(model.title == title)
        #expect(model.artist == artist)
        #expect(model.featuring == featuring)
        #expect(model.album == album)
        #expect(model.genre == "Indie pop")
        #expect(model.releasedText == released)
        #expect(model.lengthText == length)
        #expect(model.fileName == fileName)
        #expect(model.formatName == format)
        #expect(model.sizeText == size)
    }

    @Test func theTrackAndDiscReadAsNOfTotal() {
        let model = Self.model(Self.release())
        let track: String = "3 of 10"
        let disc: String = "1 of 2"
        #expect(model.trackText == track)
        #expect(model.discText == disc)
        #expect(model.trackCount == 10)
        #expect(model.discCount == 2)
    }

    @Test func aSingleDiscReleaseHasNoDiscRow() {
        let model = Self.model(Self.release(discs: false))
        #expect(model.discNumber == nil)
        #expect(model.discText == nil)
    }

    @Test func aMissingLengthIsLeftOutUntilTheFileIsRead() {
        let none = Self.model(Self.release(length: nil))
        #expect(none.lengthText == nil)
        let read = Self.model(Self.release(length: nil), readLength: 65)
        let expected: String = "1:05"
        #expect(read.lengthText == expected)
    }

    @Test func noPlaysHidesThePlaysGroup() {
        let model = Self.model(Self.release(), plays: nil)
        #expect(model.playsTotal == nil)
        #expect(model.lastPlayedText == nil)
        #expect(model.periods.isEmpty)
    }

    @Test func playsCarryTheTotalLastPlayedAndEachPeriod() {
        let plays = SongPlays(total: 124, lastPlayedDay: "2025-10-23", byPeriod: [
            .init(kind: .today, plays: 0), .init(kind: .week, plays: 12), .init(kind: .month, plays: 31), .init(kind: .year, plays: 96), .init(kind: .all, plays: 124),
        ])
        let model = Self.model(Self.release(), plays: plays)
        let rows: [SongPageModel.PeriodRow] = [
            .init(label: "Today", plays: 0), .init(label: "This week", plays: 12), .init(label: "This month", plays: 31),
            .init(label: "This year", plays: 96), .init(label: "All time", plays: 124),
        ]
        let last: String = "yesterday"
        #expect(model.playsTotal == 124)
        #expect(model.periods == rows)
        #expect(model.lastPlayedText == last)
    }

    @Test func lastPlayedReadsAsRelativeDaysThenADate() {
        let today: String = "today"
        let ago: String = "3 days ago"
        let date: String = "1 September 2025"
        #expect(SongPageModel.lastPlayed("2025-10-24", today: "2025-10-24", locale: Self.en) == today)
        #expect(SongPageModel.lastPlayed("2025-10-21", today: "2025-10-24", locale: Self.en) == ago)
        #expect(SongPageModel.lastPlayed("2025-09-01", today: "2025-10-24", locale: Self.en) == date)
        #expect(SongPageModel.lastPlayed("nonsense", today: "2025-10-24", locale: Self.en) == nil)
    }

    // MARK: Where it lives

    @Test func aPhoneHeldSongCanBePlayedEditedAndShared() {
        let model = Self.model(Self.release(), fileSize: 1_000)
        let location: String = "This iPhone"
        #expect(model.location == location)
        #expect(model.canEdit)
        #expect(model.canPlay)
        #expect(model.canShare)
        #expect(!model.isAdopted)
    }

    @Test func anAdoptedSongIsDetailsOnlyOnTheMac() {
        let model = Self.model(Self.release(adopted: true), fileSize: 9_999)
        let location: String = "On your Mac"
        let size: String = "Only on your Mac"
        let format: String = "MP3"
        #expect(model.location == location)
        #expect(!model.canEdit)
        #expect(!model.canPlay)
        #expect(!model.canShare)
        #expect(model.isAdopted)
        #expect(model.sizeText == size)
        // The path is empty, so the format comes from the name the song was imported with.
        #expect(model.formatName == format)
    }

    @Test func aPhoneSongWhoseFileIsNotReadYetHasNoSizeRow() {
        #expect(Self.model(Self.release()).sizeText == nil)
    }

    // MARK: Format and size

    @Test func formatNamesComeFromTheExtension() {
        let names: [String] = ["m4a", "mp3", "FLAC", "wav", "aiff", "xyz", ""].map { SongPageModel.formatName(forExtension: $0) }
        let expected: [String] = ["AAC (m4a)", "MP3", "FLAC", "WAV", "AIFF", "XYZ", "Unknown"]
        #expect(names == expected)
    }

    @Test func sizeTextUsesDecimalUnits() {
        let sizes: [String] = [0, 1, 512, 1_600, 999_999, 8_400_000, 1_260_000_000].map { SongPageModel.sizeText(bytes: $0) }
        let expected: [String] = ["0 bytes", "1 byte", "512 bytes", "2 KB", "1.0 MB", "8.4 MB", "1.3 GB"]
        #expect(sizes == expected)
    }

    @Test func aTrackThatIsNotInTheReleaseHasNoPage() {
        #expect(SongPageModel(release: Self.release(), trackID: UUID()) == nil)
    }

    // MARK: Collections containing a track

    @Test func aTrackItemCounts() {
        let mine = Self.collection("Late drives", [.track(releaseId: Self.releaseID, trackId: Self.trackID)])
        let other = Self.collection("Other track", [.track(releaseId: Self.releaseID, trackId: UUID())])
        let found = MusicCollection.containing(releaseId: Self.releaseID, trackId: Self.trackID, in: [mine, other])
        #expect(found.map(\.name) == ["Late drives"])
    }

    @Test func aReleaseItemCounts() {
        let whole = Self.collection("Whole album", [.release(Self.releaseID)])
        let elsewhere = Self.collection("Another album", [.release(UUID())])
        let found = MusicCollection.containing(releaseId: Self.releaseID, trackId: Self.trackID, in: [whole, elsewhere])
        #expect(found.map(\.name) == ["Whole album"])
    }

    @Test func bothKindsInOneCollectionListItOnce() {
        let both = Self.collection("Both", [.release(Self.releaseID), .track(releaseId: Self.releaseID, trackId: Self.trackID)])
        let found = MusicCollection.containing(releaseId: Self.releaseID, trackId: Self.trackID, in: [both])
        #expect(found.count == 1)
    }

    @Test func noCollectionHoldingItGivesNone() {
        let other = Self.collection("Elsewhere", [.release(UUID())])
        let empty = Self.collection("Empty", [])
        #expect(MusicCollection.containing(releaseId: Self.releaseID, trackId: Self.trackID, in: [other, empty]).isEmpty)
        #expect(MusicCollection.containing(releaseId: Self.releaseID, trackId: Self.trackID, in: []).isEmpty)
    }

    @Test func unknownItemKindsAreSkipped() {
        let unknown = Self.collection("Future kinds", [.unknown(.object(["kind": .string("podcast"), "releaseId": .string(Self.releaseID.uuidString)]))])
        #expect(MusicCollection.containing(releaseId: Self.releaseID, trackId: Self.trackID, in: [unknown]).isEmpty)
    }

    @Test func theModelListsItsCollectionsInOrder() {
        let a = Self.collection("A", [.release(Self.releaseID)])
        let b = Self.collection("B", [.track(releaseId: Self.releaseID, trackId: Self.trackID)])
        let model = Self.model(Self.release(), collections: [a, b])
        let names: [String] = model.collections.map(\.name)
        #expect(names == ["A", "B"])
    }

    // MARK: Plays from ranged reads

    private static func count(_ plays: Int, day: String?, track: UUID = SongPageModelTests.trackID, release: UUID = SongPageModelTests.releaseID) -> PlayCount {
        PlayCount(trackId: track.uuidString.lowercased(), releaseId: release.uuidString.lowercased(), plays: plays, lastPlayedDay: day)
    }

    @Test func lastPlayedIsTheLatestDayAcrossTheRangedReads() {
        let reads: [StatsPeriodKind: PlaysSummary] = [
            .week: PlaysSummary(tracks: [Self.count(2, day: "2025-10-22")], allTime: []),
            .year: PlaysSummary(tracks: [Self.count(9, day: "2025-10-23")], allTime: []),
            .all: PlaysSummary(tracks: [Self.count(9, day: "2025-10-23")], allTime: [Self.count(40, day: nil)]),
        ]
        let plays = SongPlays.make(trackID: Self.trackID, releaseID: Self.releaseID, reads: reads)
        let day: String = "2025-10-23"
        #expect(plays?.lastPlayedDay == day)
        #expect(plays?.total == 40)
        #expect(plays?.byPeriod.map(\.plays) == [2, 9, 40])
    }

    @Test func otherTracksAndOtherReleasesDoNotCount() {
        let reads: [StatsPeriodKind: PlaysSummary] = [
            .all: PlaysSummary(tracks: [], allTime: [Self.count(5, day: nil, track: UUID()), Self.count(7, day: nil, release: UUID())]),
        ]
        let plays = SongPlays.make(trackID: Self.trackID, releaseID: Self.releaseID, reads: reads)
        #expect(plays?.total == 0)
        #expect(plays?.lastPlayedDay == nil)
    }

    @Test func withoutTheAllTimeReadThereIsNothingToShow() {
        let reads: [StatsPeriodKind: PlaysSummary] = [.week: PlaysSummary(tracks: [Self.count(2, day: "2025-10-22")], allTime: [])]
        #expect(SongPlays.make(trackID: Self.trackID, releaseID: Self.releaseID, reads: reads) == nil)
    }
}
