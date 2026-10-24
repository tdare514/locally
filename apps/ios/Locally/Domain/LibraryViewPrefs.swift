import Foundation

/// How the library home lays out releases: rows in a panel, a cover grid, or the artists A to Z
/// (#288). Mirrors the web's `LibraryLayout`. Values stored before `artists` existed still load.
enum LibraryLayout: String, CaseIterable {
    case list
    case covers
    case artists

    static let `default`: LibraryLayout = .list

    /// The stored value, or the default when it is missing or unknown.
    init(storedRaw: String?) {
        self = storedRaw.flatMap(LibraryLayout.init(rawValue:)) ?? .default
    }
}

/// The three cover grid sizes, smallest first. Mirrors the web's `CoverSize`. Small is 5 or more across
/// with the title only; Large is 2 across on a phone (#360).
enum CoverSize: Int, CaseIterable {
    case small = 0
    case medium = 1
    case large = 2

    static let `default`: CoverSize = .large

    /// The stored value, or the default when it is missing or unknown.
    init(storedRaw: Int?) {
        self = storedRaw.flatMap(CoverSize.init(rawValue:)) ?? .default
    }

    /// The detent nearest a position along the slider, 0 (left end) to 1 (right end); outside that range clamps.
    static func nearest(fraction: CGFloat) -> CoverSize {
        let last = CGFloat(allCases.count - 1)
        let index = Int((min(max(fraction, 0), 1) * last).rounded(.toNearestOrAwayFromZero))
        return CoverSize(rawValue: index) ?? .default
    }

    /// The detent `step` places along, stopping at the ends.
    func stepped(by step: Int) -> CoverSize {
        CoverSize(rawValue: min(max(rawValue + step, 0), CoverSize.allCases.count - 1)) ?? self
    }

    /// Minimum tile width for the adaptive grid.
    var tileMinWidth: CGFloat { Theme.Library.tileMinWidth[rawValue] }
    /// Gap between tiles, both ways.
    var tileGap: CGFloat { Theme.Library.tileGap[rawValue] }
    /// Small tiles show the title alone.
    var showsSubtitle: Bool { self != .small }
}

/// `UserDefaults` / `@AppStorage` keys for the library view choices.
enum LibraryViewPrefs {
    static let layoutKey = "locally.library.layout"
    static let sortKey = "locally.library.sort"
    /// The size choice moved to a new key in #360, when the three sizes were remapped.
    static let coverSizeKey = "locally.library.coverSize2"
    static let legacyCoverSizeKey = "locally.library.coverSize"
    static let singlesCollapsedKey = "locally.library.singlesCollapsed"
    static let albumsCollapsedKey = "locally.library.albumsCollapsed"

    /// The new-key value for a stored choice: the new key wins; otherwise the old one is remapped
    /// (old Small to Medium, old Medium and old Large to Large); nil when neither was ever set.
    static func migratedCoverSize(newRaw: Int?, legacyRaw: Int?) -> Int? {
        if let newRaw { return newRaw }
        guard let legacyRaw else { return nil }
        return legacyRaw == 0 ? CoverSize.medium.rawValue : CoverSize.large.rawValue
    }

    /// Moves the old size choice to the new key, once. The old key is left alone.
    static func migrateCoverSize(in defaults: UserDefaults = .standard) {
        guard defaults.object(forKey: coverSizeKey) == nil,
              let moved = migratedCoverSize(newRaw: nil, legacyRaw: defaults.object(forKey: legacyCoverSizeKey) as? Int)
        else { return }
        defaults.set(moved, forKey: coverSizeKey)
    }
}
