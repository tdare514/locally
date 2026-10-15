import Foundation
import Testing
import UIKit
@testable import Locally

/// A `CoverStore` that cancels a task the first time the loader asks it for a cover file,
/// and counts how many it was asked for, so a test can see the loop stop early.
private final class CancellingCoverStore: CoverStore {
    private let base = FakeCoverStore()
    private let lock = NSLock()
    private var reads = 0
    var onFirstRead: (() -> Void)?

    var readCount: Int { lock.withLock { reads } }

    func save(_ data: Data, for id: UUID) throws -> String { try base.save(data, for: id) }
    func load(_ id: UUID) -> Data? { base.load(id) }
    func delete(_ id: UUID) throws { try base.delete(id) }

    func fileURL(_ id: UUID) -> URL? {
        let isFirst = lock.withLock { () -> Bool in
            reads += 1
            return reads == 1
        }
        if isFirst { onFirstRead?() }
        return base.fileURL(id)
    }
}

@Suite @MainActor struct RecentCoversLoaderTests {

    private let base = Date(timeIntervalSince1970: 1_700_000_000)

    /// A real, tiny PNG, so the loader's thumbnail decode has something to decode.
    private func pngData(side: CGFloat = 8) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { context in
            UIColor.systemPink.setFill()
            context.fill(CGRect(x: 0, y: 0, width: side, height: side))
        }
        return image.pngData()!
    }

    /// Adds a release updated `minutes` after `base`; `cover` decides whether the store holds one.
    @discardableResult
    private func add(
        _ title: String, artist: String = "Artist", minutes: Int, cover: Data? = nil,
        to library: InMemoryLibraryStore, covers: FakeCoverStore
    ) throws -> Release {
        let release = Release(
            kind: .single, title: title, artist: artist, folderPath: "/tmp/x",
            tracks: [Track(title: title, trackNumber: 1, filePath: "\(title).mp3", originalName: "\(title).mp3")],
            createdAt: base, updatedAt: base.addingTimeInterval(Double(minutes) * 60)
        )
        try library.upsert(release)
        if let cover { _ = try covers.save(cover, for: release.id) }
        return release
    }

    @Test func readsOnlyTheNewestTwelveReleasesNotTheWholeLibrary() async throws {
        let library = InMemoryLibraryStore()
        let covers = FakeCoverStore()
        for minute in 0..<30 {
            try add("R\(minute)", minutes: minute, cover: pngData(), to: library, covers: covers)
        }

        let recents = await RecentCoversLoader(library: library, coverStore: covers).load()
        #expect(recents.count == 12)
        #expect(library.recentLimits == [RecentCoversLoader.limit])
        #expect(library.allCallCount == 0)
    }

    @Test func widensTheFetchOnlyWhenSkippedReleasesLeaveTheRowShort() async throws {
        let library = InMemoryLibraryStore()
        let covers = FakeCoverStore()
        try add("No cover A", minutes: 100, to: library, covers: covers)
        try add("No cover B", minutes: 99, to: library, covers: covers)
        for minute in 0..<13 {
            try add("C\(minute)", minutes: minute, cover: pngData(), to: library, covers: covers)
        }

        let recents = await RecentCoversLoader(library: library, coverStore: covers).load()
        #expect(recents.count == 12)
        #expect(library.recentLimits == [12, 24])
        #expect(library.allCallCount == 0)
    }

    @Test func cancellingTheLoadStopsTheThumbnailLoopEarly() async throws {
        let library = InMemoryLibraryStore()
        let covers = CancellingCoverStore()
        for minute in 0..<12 {
            let release = try add("R\(minute)", minutes: minute, to: library, covers: FakeCoverStore())
            _ = try covers.save(pngData(), for: release.id)
        }

        let task = Task { @MainActor in
            await RecentCoversLoader(library: library, coverStore: covers).load()
        }
        // The task cannot start before this test suspends on `task.value`, so this is set in time.
        covers.onFirstRead = { task.cancel() }
        let recents = await task.value

        #expect(covers.readCount == 1)
        #expect(recents.count <= 1)
        #expect(library.recentLimits == [12])
    }

    @Test func emptyLibraryReturnsNoCovers() async {
        let loader = RecentCoversLoader(library: InMemoryLibraryStore(), coverStore: FakeCoverStore())
        #expect(await loader.load().isEmpty)
    }

    @Test func newestReleaseComesFirst() async throws {
        let library = InMemoryLibraryStore()
        let covers = FakeCoverStore()
        let middle = try add("Middle", minutes: 5, cover: pngData(), to: library, covers: covers)
        let oldest = try add("Oldest", minutes: 1, cover: pngData(), to: library, covers: covers)
        let newest = try add("Newest", minutes: 9, cover: pngData(), to: library, covers: covers)

        let recents = await RecentCoversLoader(library: library, coverStore: covers).load()
        #expect(recents.map(\.id) == [newest.id, middle.id, oldest.id])
        #expect(recents.map(\.title) == ["Newest", "Middle", "Oldest"])
    }

    @Test func isCappedAtTwelveNewestCovers() async throws {
        let library = InMemoryLibraryStore()
        let covers = FakeCoverStore()
        var releases: [Release] = []
        for minute in 0..<15 {
            releases.append(try add("R\(minute)", minutes: minute, cover: pngData(), to: library, covers: covers))
        }

        let recents = await RecentCoversLoader(library: library, coverStore: covers).load()
        #expect(RecentCoversLoader.limit == 12)
        #expect(recents.count == 12)
        #expect(recents.map(\.id) == releases.suffix(12).reversed().map(\.id))
    }

    @Test func skipsReleasesWithoutACoverAndTheyDoNotUseUpTheCap() async throws {
        let library = InMemoryLibraryStore()
        let covers = FakeCoverStore()
        // The two newest releases have no cover; the 13 older ones do.
        try add("No cover A", minutes: 100, to: library, covers: covers)
        try add("No cover B", minutes: 99, to: library, covers: covers)
        var withCover: [Release] = []
        for minute in 0..<13 {
            withCover.append(try add("C\(minute)", minutes: minute, cover: pngData(), to: library, covers: covers))
        }

        let recents = await RecentCoversLoader(library: library, coverStore: covers).load()
        #expect(recents.count == 12)
        #expect(recents.map(\.id) == withCover.suffix(12).reversed().map(\.id))
        #expect(!recents.contains { $0.title.hasPrefix("No cover") })
    }

    @Test func skipsACoverThatWillNotDecode() async throws {
        let library = InMemoryLibraryStore()
        let covers = FakeCoverStore()
        try add("Broken", minutes: 9, cover: Data("not an image".utf8), to: library, covers: covers)
        let good = try add("Good", minutes: 1, cover: pngData(), to: library, covers: covers)

        let recents = await RecentCoversLoader(library: library, coverStore: covers).load()
        #expect(recents.map(\.id) == [good.id])
    }

    @Test func thumbnailsAreDownsampledAndLabelledWithTitleAndArtist() async throws {
        let library = InMemoryLibraryStore()
        let covers = FakeCoverStore()
        try add("Rumours", artist: "Fleetwood Mac", minutes: 1, cover: pngData(side: 1000), to: library, covers: covers)

        let recents = await RecentCoversLoader(library: library, coverStore: covers).load()
        let recent = try #require(recents.first)
        let longestSide = max(recent.thumbnail.size.width, recent.thumbnail.size.height) * recent.thumbnail.scale
        #expect(longestSide <= CGFloat(RecentCoversLoader.thumbnailPixels))
        #expect(recent.accessibilityLabel == "Rumours, Fleetwood Mac")
    }
}
