import Foundation

/// The Library's filter (#446): everything, only singles, only albums, or one genre. Kept between launches as a
/// string (`all`, `singles`, `albums`, `genre:<name>`), so a value it doesn't know falls back to everything.
enum LibraryFilter: Hashable, RawRepresentable {
    case all
    case singles
    case albums
    case genre(String)

    static let `default`: LibraryFilter = .all
    private static let genrePrefix = "genre:"

    var rawValue: String {
        switch self {
        case .all: return "all"
        case .singles: return "singles"
        case .albums: return "albums"
        case .genre(let name): return Self.genrePrefix + name
        }
    }

    init(rawValue: String) {
        switch rawValue {
        case "singles": self = .singles
        case "albums": self = .albums
        case _ where rawValue.hasPrefix(Self.genrePrefix) && rawValue.count > Self.genrePrefix.count:
            self = .genre(String(rawValue.dropFirst(Self.genrePrefix.count)))
        default: self = .all
        }
    }

    var isDefault: Bool { self == .all }

    /// The filter's choices for a library: All, Singles, Albums, then each genre once, A to Z.
    static func options(for releases: [Release]) -> [LibraryFilter] {
        [.all, .singles, .albums] + genres(in: releases).map { .genre($0) }
    }

    /// The genres present, each once (case and accents folded, the first spelling kept), A to Z.
    static func genres(in releases: [Release]) -> [String] {
        var seen: [String: String] = [:]
        for release in releases {
            let name = (release.genre ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let key = LibrarySearch.normalize(name)
            if !key.isEmpty, seen[key] == nil { seen[key] = name }
        }
        return seen.values.sorted { LibrarySort.compareText($0, $1) == .orderedAscending }
    }

    /// A genre filter for a genre no release has any more (the last one was deleted or edited) shows everything,
    /// so the list is never empty with no way to see why. `options` is `options(for:)` of the library.
    func resolved(among options: [LibraryFilter]) -> LibraryFilter {
        guard case .genre(let name) = self else { return self }
        let wanted = LibrarySearch.normalize(name)
        return options.contains { option in
            if case .genre(let present) = option { return LibrarySearch.normalize(present) == wanted }
            return false
        } ? self : .all
    }

    func includes(_ release: Release) -> Bool {
        switch self {
        case .all: return true
        case .singles: return release.kind == .single
        case .albums: return release.kind == .album
        case .genre(let name):
            return LibrarySearch.normalize(release.genre ?? "") == LibrarySearch.normalize(name)
        }
    }

    func apply(_ releases: [Release]) -> [Release] {
        isDefault ? releases : releases.filter(includes)
    }
}
