import SwiftUI

/// The app's dark palette, defined once so every screen matches: near-black
/// background, slightly-lighter panels, white/secondary text, and the
/// orange accent (deliberately not Spotify's green — see App Store brand
/// rules in `docs/ios-plan.md`).
enum Theme {
    static let background = Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x12 / 255)
    static let panel = Color(red: 0x18 / 255, green: 0x18 / 255, blue: 0x18 / 255)
    static let primaryText = Color.white
    static let secondaryText = Color(red: 0xB3 / 255, green: 0xB3 / 255, blue: 0xB3 / 255)
    static let accent = Color(red: 1.0, green: 0x7A / 255, blue: 0.0)
}
