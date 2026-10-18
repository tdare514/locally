import Foundation

/// How the library home orders Singles and Albums. Mirrors the web's `LibrarySort` and
/// `LIBRARY_SORT_OPTIONS` in `apps/web/src/lib/library-sections.ts`.
enum LibrarySortOption: String, CaseIterable {
    case newest
    case title
    case artist
    case year

    static let `default`: LibrarySortOption = .newest

    /// The stored value, or the default when it is missing or unknown.
    init(storedRaw: String?) {
        self = storedRaw.flatMap(LibrarySortOption.init(rawValue:)) ?? .default
    }
}

/// The sort comparisons, ported from the web's `sortLibrary`. Pure.
enum LibrarySort {
    /// Case- and accent-insensitive, digits by value ("Track 2" before "Track 10"): the web's
    /// `localeCompare` with `sensitivity: "base", numeric: true`.
    static func compareText(_ a: String, _ b: String) -> ComparisonResult {
        a.compare(b, options: [.caseInsensitive, .diacriticInsensitive, .numeric], range: nil, locale: Locale(identifier: "en"))
    }

    /// The year as a number: its leading digits (as `parseInt`), nil when there are none.
    static func parseYear(_ year: String?) -> Int? {
        guard let year else { return nil }
        let digits = year.trimmingCharacters(in: .whitespacesAndNewlines).prefix { $0.isASCII && $0.isNumber }
        return Int(digits)
    }

    /// A sorted copy. Equal releases keep their input order, as the web's stable sort does.
    static func sorted(_ releases: [Release], by option: LibrarySortOption) -> [Release] {
        let indexed = Array(releases.enumerated())
        let ordered = indexed.sorted { a, b in
            let result = compare(a.element, b.element, by: option)
            return result == .orderedSame ? a.offset < b.offset : result == .orderedAscending
        }
        return ordered.map(\.element)
    }

    private static func compare(_ a: Release, _ b: Release, by option: LibrarySortOption) -> ComparisonResult {
        switch option {
        case .newest:
            return compareUpdatedDesc(a, b)
        case .title:
            return first(compareText(a.title, b.title), compareText(a.artist, b.artist), compareUpdatedDesc(a, b))
        case .artist:
            return first(compareText(a.artist, b.artist), compareText(a.title, b.title), compareUpdatedDesc(a, b))
        case .year:
            let ay = parseYear(a.year)
            let by = parseYear(b.year)
            if ay == nil && by == nil { return compareText(a.title, b.title) }
            guard let ay else { return .orderedDescending }
            guard let by else { return .orderedAscending }
            if ay != by { return ay > by ? .orderedAscending : .orderedDescending }
            return compareText(a.title, b.title)
        }
    }

    private static func compareUpdatedDesc(_ a: Release, _ b: Release) -> ComparisonResult {
        a.updatedAt == b.updatedAt ? .orderedSame : (a.updatedAt > b.updatedAt ? .orderedAscending : .orderedDescending)
    }

    /// The first result that is not "same", as the web's `a || b || c`.
    private static func first(_ results: ComparisonResult...) -> ComparisonResult {
        results.first { $0 != .orderedSame } ?? .orderedSame
    }
}
