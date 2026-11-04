import Foundation

/// A proposed group that is a release already synced from another device (#332): adopting it links its files
/// here to that release instead of making a second one.
struct AdoptMatch: Equatable {
    struct Link: Equatable {
        var trackId: UUID
        /// Relative to the Spotify folder.
        var path: String
    }

    var releaseId: UUID
    var links: [Link]
}

enum AdoptMatching {
    /// The synced adopted release (adopted on another device, not yet fully linked) every one of whose group tracks
    /// matches a still-unlinked track of by `localId`, or nil. A track matches the same song (artist, album, title)
    /// with the same whole seconds; a length one second off also matches when no exact one is left, since two
    /// devices can read a VBR file's length a second apart. Names are never used. A release this phone adopted
    /// itself is not a candidate: the same song in a second folder is a second release, as on the Mac.
    static func match(_ group: ProposedGroup, in releases: [Release]) -> AdoptMatch? {
        guard !group.tracks.isEmpty else { return nil }
        let candidates = releases
            .filter { $0.isAdopted && !$0.adoptedHere && $0.tracks.count >= group.tracks.count }
            .sorted { ($0.createdAt, $0.id.uuidString) < ($1.createdAt, $1.id.uuidString) }
        for release in candidates {
            if let links = links(for: group, in: release) {
                return AdoptMatch(releaseId: release.id, links: links)
            }
        }
        return nil
    }

    private static func links(for group: ProposedGroup, in release: Release) -> [AdoptMatch.Link]? {
        var free: [(id: UUID, identity: String, seconds: Int)] = release.tracks.compactMap { track in
            guard track.spotifyPath == nil, let id = track.localId, let parts = LocalId.split(id) else { return nil }
            return (id: track.id, identity: parts.identity, seconds: parts.seconds)
        }
        var links: [AdoptMatch.Link] = []
        // Exact lengths claim first, so a near miss never takes the track an exact one needs.
        var unmatched: [(track: ProposedTrack, identity: String, seconds: Int)] = []
        for track in group.tracks {
            guard let parts = LocalId.split(track.localId) else { return nil }
            if let index = free.firstIndex(where: { $0.identity == parts.identity && $0.seconds == parts.seconds }) {
                links.append(AdoptMatch.Link(trackId: free[index].id, path: track.path))
                free.remove(at: index)
            } else {
                unmatched.append((track: track, identity: parts.identity, seconds: parts.seconds))
            }
        }
        for item in unmatched {
            guard let index = free.firstIndex(where: { $0.identity == item.identity && abs($0.seconds - item.seconds) <= 1 }) else {
                return nil
            }
            links.append(AdoptMatch.Link(trackId: free[index].id, path: item.track.path))
            free.remove(at: index)
        }
        return links
    }
}
