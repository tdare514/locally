import Foundation
import Observation

/// One thing a tap adds: a whole release, or one song of it (#366).
struct BuilderPick: Hashable {
    let releaseID: UUID
    var trackID: UUID?

    var item: CollectionItem {
        trackID.map { .track(releaseId: releaseID, trackId: $0) } ?? .release(releaseID)
    }

    /// `nil` for an item kind this phone doesn't know.
    init?(_ item: CollectionItem) {
        switch item {
        case .release(let id): self.init(releaseID: id)
        case .track(let releaseId, let trackId): self.init(releaseID: releaseId, trackID: trackId)
        case .unknown: return nil
        }
    }

    init(releaseID: UUID, trackID: UUID? = nil) {
        self.releaseID = releaseID
        self.trackID = trackID
    }
}

/// How a release or song reads in the builder.
enum BuilderRowState: Equatable {
    case off
    case on
    /// A song of a release that is picked whole.
    case viaRelease
    /// Already in the collection ("Add music"): shown, not toggleable.
    case existing
}

/// What the collection builder holds while it grows (#366): the name, the picks in order, the search, and the rules for
/// a tap. Pure over the releases it is given, so tests drive it without a store or a screen. `existing` is what an
/// existing collection already holds ("Add music"); the name is then fixed.
@MainActor
@Observable
final class BuilderDraft {
    let releases: [Release]
    let isNew: Bool
    let existing: [BuilderPick]
    var name: String
    var query = ""
    private(set) var picks: [BuilderPick]

    init(releases: [Release], name: String = "", existing: [CollectionItem]? = nil, picks: [BuilderPick] = []) {
        self.releases = releases
        self.isNew = existing == nil
        self.existing = (existing ?? []).compactMap(BuilderPick.init)
        self.name = name
        self.picks = picks
    }

    // MARK: Reading

    func release(_ id: UUID) -> Release? { releases.first { $0.id == id } }

    func state(of pick: BuilderPick) -> BuilderRowState {
        let whole = BuilderPick(releaseID: pick.releaseID)
        if existing.contains(pick) || (pick.trackID != nil && existing.contains(whole)) { return .existing }
        if picks.contains(pick) { return .on }
        if pick.trackID != nil, picks.contains(whole) { return .viaRelease }
        return .off
    }

    private func songs(in pick: BuilderPick) -> [Track] {
        guard let release = release(pick.releaseID) else { return [] }
        if let trackID = pick.trackID { return release.tracks.filter { $0.id == trackID } }
        return release.tracks
    }

    var songCount: Int { picks.reduce(0) { $0 + songs(in: $1).count } }

    /// Seconds of the picked songs this phone holds: an adopted song plays on the Mac, so it counts in songs, not here.
    var seconds: Double {
        picks.reduce(0) { total, pick in
            guard release(pick.releaseID)?.source != .adopted else { return total }
            let lengths: [Double] = songs(in: pick).compactMap(\.durationSec).filter { $0.isFinite && $0 > 0 }
            return total + lengths.reduce(0, +)
        }
    }

    /// "3 songs · 7 min", "1 new song" when adding.
    var summary: String {
        guard songCount > 0 else { return Copy.CollectionBuilder.nothingPicked }
        let count = isNew ? Copy.CollectionBuilder.songCount(songCount) : Copy.CollectionBuilder.newSongCount(songCount)
        return Copy.CollectionBuilder.summary(count, seconds: seconds)
    }

    /// Done needs something picked, and for a new collection a name that passes `MusicCollection.validName`.
    var canFinish: Bool {
        songCount > 0 && (!isNew || MusicCollection.validName(name) != nil)
    }

    var hasChanges: Bool { !picks.isEmpty || (isNew && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }

    /// The picks as collection items, in the order they were picked.
    var items: [CollectionItem] { picks.map(\.item) }

    var releaseMatches: [Release] { LibrarySearch.filter(releases, query: query) }

    /// Songs whose title or artist contains every word of the query.
    var songMatches: [(release: Release, track: Track)] {
        let tokens = LibrarySearch.normalize(query).split(separator: " ").map(String.init)
        return releases.flatMap { release in
            release.tracks.compactMap { track -> (release: Release, track: Track)? in
                let haystack = LibrarySearch.normalize("\(track.title) \(release.artist)")
                return tokens.allSatisfy { haystack.contains($0) } ? (release, track) : nil
            }
        }
    }

    /// The first four different releases among what the collection holds and what is picked: the sleeve's mosaic.
    var mosaicReleaseIDs: [UUID] {
        var ids: [UUID] = []
        for pick in existing + picks where !ids.contains(pick.releaseID) && release(pick.releaseID)?.coverPath != nil {
            ids.append(pick.releaseID)
            if ids.count == 4 { break }
        }
        return ids
    }

    // MARK: Editing

    /// A tap. An existing item or a song of a picked release does nothing; a release replaces its picked songs.
    func toggle(_ pick: BuilderPick) {
        switch state(of: pick) {
        case .existing, .viaRelease: return
        case .on: picks.removeAll { $0 == pick }
        case .off:
            if pick.trackID == nil { picks.removeAll { $0.releaseID == pick.releaseID } }
            picks.append(pick)
        }
    }
}
