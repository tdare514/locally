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

/// The three cover grid sizes, smallest first. Mirrors the web's `CoverSize`.
enum CoverSize: Int, CaseIterable {
    case compact = 0
    case medium = 1
    case large = 2

    static let `default`: CoverSize = .medium

    /// The stored value, or the default when it is missing or unknown.
    init(storedRaw: Int?) {
        self = storedRaw.flatMap(CoverSize.init(rawValue:)) ?? .default
    }

    /// Minimum tile width for the adaptive grid.
    var tileMinWidth: CGFloat { Theme.Library.tileMinWidth[rawValue] }
    /// Gap between tiles, both ways.
    var tileGap: CGFloat { Theme.Library.tileGap[rawValue] }
}

/// `UserDefaults` / `@AppStorage` keys for the library view choices.
enum LibraryViewPrefs {
    static let layoutKey = "locally.library.layout"
    static let sortKey = "locally.library.sort"
    static let coverSizeKey = "locally.library.coverSize"
    static let singlesCollapsedKey = "locally.library.singlesCollapsed"
    static let albumsCollapsedKey = "locally.library.albumsCollapsed"
}
