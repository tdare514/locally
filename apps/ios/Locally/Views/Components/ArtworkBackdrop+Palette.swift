import SwiftUI

extension ArtworkBackdrop {
    /// The shared `AmbientPalette` to backdrop bridge: parses the palette's "#rrggbb"
    /// strings into colours. The release page (#126) is expected to use this in place
    /// of its private `color(hex:)`.
    init(palette: AmbientPalette) {
        self.init(
            primary: Self.color(hex: palette.primary),
            secondary: Self.color(hex: palette.secondary),
            deep: Self.color(hex: palette.deep)
        )
    }

    private static func color(hex: String) -> Color {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return Theme.background }
        return Color(
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255
        )
    }
}
