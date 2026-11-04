import Foundation
import os

/// What the review page shows: each found release, and whether it is one already synced from another device.
struct AdoptReview: Equatable {
    struct Item: Identifiable, Equatable {
        var group: ProposedGroup
        /// Set when the group's songs are a release already in the library from another device: adding it links
        /// the files here to that release instead of making a second one.
        var match: AdoptMatch?
        var id: String { group.key }
        var isOnMac: Bool { match != nil }
    }

    var items: [Item]
    var skipped: [String: Int]
    var unreadable: Int

    var trackCount: Int { items.reduce(0) { $0 + $1.group.tracks.count } }
    var skippedCount: Int { skipped.values.reduce(0, +) }
}

/// What adopting did.
struct AdoptOutcome: Equatable {
    /// Releases newly added from this phone's Spotify folder.
    var added = 0
    /// Releases already synced from another device whose files here were linked.
    var linked = 0
    /// Groups whose files were all adopted before.
    var alreadyAdded = 0
    /// Titles that could not be added; the rest still went through.
    var failed: [String] = []
}

/// Adopts the music already in the phone's own Spotify folder (#332 step 3). Read only: it opens the folder through
/// `SpotifyFolderAccess.withAccess`, reads tags and one cover per release, and writes only Locally's own data (the
/// library index and the cover in Application Support). An adopted file is never written, moved, re-tagged or deleted;
/// "delete" on an adopted release forgets it.
///
/// A new release is details only, with paths relative to the Spotify folder so it plays through `PlaybackService`, and
/// syncs with `source: "adopted"` uploading only its cover. A group whose songs match a release already synced from
/// another device (by `localId`) links its files to that release's id instead: no new record, no push.
@MainActor
final class SpotifyAdopter {
    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "Locally", category: "adopt")

    private let folder: SpotifyFolderAccess
    private let library: LibraryStore
    private let coverStore: CoverStore
    private let reader: AdoptTagReading

    /// Set by `AppContainer`, like the coordinator's: new releases are pushed through it.
    weak var syncHook: ReleaseSyncHook?

    init(folder: SpotifyFolderAccess, library: LibraryStore, coverStore: CoverStore, reader: AdoptTagReading = AVAdoptTagReader()) {
        self.folder = folder
        self.library = library
        self.coverStore = coverStore
        self.reader = reader
    }

    // MARK: Scan

    /// One look through the folder. Runs only when the user asks (Settings, or the offer after onboarding), never on
    /// launch.
    func scan(onProgress: @MainActor (Int, Int) -> Void = { _, _ in }) async throws -> AdoptReview {
        let releases = try library.all()
        let scanner = SpotifyFolderScanner(reader: reader)
        let found: AdoptScan = try await folder.withAccess { (root: URL) async throws -> AdoptScan in
            let tracked = Self.trackedPaths(of: releases, root: root)
            return await scanner.scan(root: root, tracked: tracked, onProgress: onProgress)
        }
        // TODO(#332 step 2): report holdings (which releases this phone holds) once PUT /v1/holdings exists.
        return Self.review(of: found, releases: releases)
    }

    /// Pure: pairs each group with the synced release it matches, if any.
    static func review(of found: AdoptScan, releases: [Release]) -> AdoptReview {
        AdoptReview(
            items: found.groups.map { AdoptReview.Item(group: $0, match: AdoptMatching.match($0, in: releases)) },
            skipped: found.skipped,
            unreadable: found.unreadable
        )
    }

    /// Paths, relative to the Spotify folder, that Locally already tracks: files of its own releases (stored absolute) and
    /// the files an adopted release is linked to.
    static func trackedPaths(of releases: [Release], root: URL) -> Set<String> {
        let rootPath = root.resolvingSymlinksInPath().path
        var tracked = Set<String>()
        for release in releases {
            for track in release.tracks {
                if let relative = track.spotifyPath {
                    tracked.insert(relative)
                } else if !release.isAdopted {
                    let path = URL(fileURLWithPath: track.filePath).resolvingSymlinksInPath().path
                    if path.hasPrefix(rootPath + "/") { tracked.insert(String(path.dropFirst(rootPath.count + 1))) }
                }
            }
        }
        return tracked
    }

    /// The cover a review row shows: the synced release's own when it matches one, else the first embedded picture
    /// of the group, read in place. Nil when there is none.
    func previewCover(for item: AdoptReview.Item) async -> Data? {
        if let match = item.match { return coverStore.load(match.releaseId) }
        guard let from = item.group.coverFrom else { return nil }
        return try? await folder.withAccess { (root: URL) async throws -> Data? in
            guard Self.isSafeRelativePath(from, in: root) else { return nil }
            return await self.reader.coverData(at: root.appendingPathComponent(from))
        }
    }

    // MARK: Adopt

    /// Adds the ticked groups of `review`. A failure on one group does not stop the others.
    @discardableResult
    func adopt(_ review: AdoptReview, keys: Set<String>) async throws -> AdoptOutcome {
        let chosen = review.items.filter { keys.contains($0.id) }
        guard !chosen.isEmpty else { return AdoptOutcome() }
        return try await folder.withAccess { (root: URL) async throws -> AdoptOutcome in
            var outcome = AdoptOutcome()
            var releases = try self.library.all()
            var tracked = Self.trackedPaths(of: releases, root: root)
            for item in chosen {
                let group = item.group
                let paths = group.tracks.map(\.path) + (group.coverFrom.map { [$0] } ?? [])
                guard paths.allSatisfy({ Self.isSafeRelativePath($0, in: root) }) else {
                    outcome.failed.append(group.title)
                    continue
                }
                if group.tracks.allSatisfy({ tracked.contains($0.path) }) {
                    outcome.alreadyAdded += 1
                    continue
                }
                do {
                    // Matched again against the library as it is now: it may have changed since the scan.
                    if let match = AdoptMatching.match(group, in: releases) {
                        guard let updated = try self.link(match, in: releases) else {
                            outcome.failed.append(group.title)
                            continue
                        }
                        releases = releases.map { $0.id == updated.id ? updated : $0 }
                        outcome.linked += 1
                    } else {
                        let release = try await self.makeRelease(from: group, root: root)
                        releases.append(release)
                        outcome.added += 1
                        self.syncHook?.pushAfterChange(release)
                    }
                    tracked.formUnion(group.tracks.map(\.path))
                } catch {
                    Self.log.error("Couldn't adopt \(group.title, privacy: .private): \(error.localizedDescription, privacy: .public)")
                    outcome.failed.append(group.title)
                }
            }
            // TODO(#332 step 2): report holdings after an adopt (the releases this phone now holds).
            return outcome
        }
    }

    /// Links the files to the existing release. Touches neither `updatedAt` nor the sync markers: the record is
    /// unchanged and nothing is pushed; this is local knowledge of where the audio is.
    private func link(_ match: AdoptMatch, in releases: [Release]) throws -> Release? {
        guard var release = releases.first(where: { $0.id == match.releaseId }) else { return nil }
        for link in match.links {
            guard let index = release.tracks.firstIndex(where: { $0.id == link.trackId }) else { return nil }
            release.tracks[index].spotifyPath = link.path
        }
        guard try library.updateIfPresent(release) else { return nil }
        return release
    }

    private func makeRelease(from group: ProposedGroup, root: URL) async throws -> Release {
        let id = UUID()
        var coverPath: String?
        if let coverFrom = group.coverFrom,
           let data = await reader.coverData(at: root.appendingPathComponent(coverFrom)) {
            coverPath = try? coverStore.save(data, for: id)
        }
        let numbers = AdoptGrouping.releaseWideNumbers(group.tracks)
        let tracks = zip(group.tracks, numbers).map { proposed, number in
            Track(
                title: proposed.title,
                trackNumber: number,
                discNumber: proposed.discNumber,
                filePath: AdoptGrouping.fileName(of: proposed.path),
                originalName: AdoptGrouping.fileName(of: proposed.path),
                durationSec: proposed.durationSec > 0 ? proposed.durationSec : nil,
                localId: proposed.localId,
                spotifyPath: proposed.path
            )
        }
        let now = Date()
        var release = Release(
            id: id, kind: group.kind, title: group.title, artist: group.artist,
            year: group.year, genre: group.genre, coverPath: coverPath,
            folderPath: "", tracks: tracks, createdAt: now, updatedAt: now,
            source: .adopted, adoptedHere: true
        )
        release.date = group.year.flatMap(ReleaseDate.fromTag)
        do {
            try library.upsert(release)
        } catch {
            try? coverStore.delete(id)
            throw LocallyError.libraryFailed(error.localizedDescription)
        }
        return release
    }

    /// A path from a scan is relative, has no empty, `.` or `..` part, stays out of the `Locally/` folder, and
    /// resolves inside the folder by the same check every write uses.
    static func isSafeRelativePath(_ path: String, in root: URL) -> Bool {
        guard !path.isEmpty, !path.hasPrefix("/") else { return false }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !parts.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else { return false }
        guard parts.first.map(String.init) != Brand.folderName else { return false }
        return ReleaseLayout().isInside(folder: root, path: root.appendingPathComponent(path).path)
    }
}

extension AdoptGrouping {
    /// The release-wide position each track keeps. The tags' own numbers are used when they are unique, every one
    /// is 1 or more and no disc is set; otherwise the tracks are numbered 1... in play order, because
    /// `Track.trackNumber` never restarts per disc.
    static func releaseWideNumbers(_ tracks: [ProposedTrack]) -> [Int] {
        let tagged = tracks.map(\.trackNumber)
        let hasDiscs = tracks.contains { $0.discNumber != nil }
        if !hasDiscs, tagged.allSatisfy({ $0 >= 1 }), Set(tagged).count == tagged.count { return tagged }
        return tracks.indices.map { $0 + 1 }
    }
}
