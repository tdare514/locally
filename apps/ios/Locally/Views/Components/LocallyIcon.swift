import SwiftUI

/// The Mac app's hand-drawn glyphs on the iPhone (#213), from the `Icon/` template images in the
/// asset catalog (24-unit viewBox, stroke 2, round caps). Where the owner chose to keep an SF Symbol
/// (the music note, `photo.badge.plus`, trash, checkmarks, seals, folder, iphone, photo,
/// `rectangle.stack.fill`, `paperplane.fill` and system menus) nothing here replaces it; the gear,
/// the list and grid glyphs, the transport glyphs and sort are drawn since #412 (and filter, #446), and the three-bar
/// now-playing mark is shared with the Mac since #414.
///
/// Used like `Image(systemName:)`: it takes the foreground style, and scales with Dynamic Type from
/// a base size set against the text style it sits beside. A glyph next to a fixed-size font passes
/// `scaled: false`, so it stays the size of the symbol it replaced. The tab bar uses
/// `Image("Icon/…")` in a `Label` instead, so the system tab bar keeps its selected-tab tint.
struct LocallyIcon: View {
    enum Name: String {
        case library = "Icon/Library"
        case plus = "Icon/Plus"
        case stats = "Icon/Stats"
        case person = "Icon/Person"
        case chevronRight = "Icon/ChevronRight"
        case x = "Icon/X"
        case pencil = "Icon/Pencil"
        case search = "Icon/Search"
        case copy = "Icon/Copy"
        case settings = "Icon/Settings"
        case play = "Icon/Play"
        case pause = "Icon/Pause"
        case next = "Icon/Next"
        case previous = "Icon/Previous"
        case grid = "Icon/Grid"
        case list = "Icon/List"
        case sort = "Icon/Sort"
        case filter = "Icon/Filter"
        case nowPlaying = "Icon/NowPlaying"
    }

    let name: Name
    var mirrored = false
    private let scales: Bool
    private let baseSize: CGFloat
    @ScaledMetric private var scaledSize: CGFloat

    /// `size` is the point size of the 24-unit square at the default text size.
    init(_ name: Name, size: CGFloat = 22, relativeTo style: Font.TextStyle = .body, scaled: Bool = true, mirrored: Bool = false) {
        self.name = name
        self.mirrored = mirrored
        self.scales = scaled
        self.baseSize = size
        _scaledSize = ScaledMetric(wrappedValue: size, relativeTo: style)
    }

    var body: some View {
        let side = scales ? scaledSize : baseSize
        Image(name.rawValue)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: side, height: side)
            .scaleEffect(x: mirrored ? -1 : 1)
            .accessibilityHidden(true)
    }
}
