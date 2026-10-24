import SwiftUI

/// The tinted glass thumb of the Import screen's Single / Album switch (`GlowSwitch`), on any shape: a dark
/// base under the cover's colour at 55 %, a white 35 % rim and a glow in the tint. `specular` adds a small
/// white highlight at the top left, for a round thumb that should read as a glass bead. Static; the caller moves it.
struct TintedGlassThumb<S: InsettableShape>: View {
    let shape: S
    let tint: Color
    var specular = false

    var body: some View {
        // A dark base under the tint keeps white on top of it at 4.5:1 or better on a bright colour.
        shape
            .fill(Color.black.opacity(Theme.Import.kindThumbBase))
            .overlay(shape.fill(tint.opacity(0.55)))
            .overlay {
                if specular {
                    GeometryReader { geo in
                        RadialGradient(
                            colors: [.white.opacity(Theme.Library.thumbSpecularOpacity), .clear],
                            center: UnitPoint(x: 0.3, y: 0.25),
                            startRadius: 0,
                            endRadius: geo.size.width * 0.5
                        )
                    }
                    .clipShape(shape)
                }
            }
            .overlay(shape.strokeBorder(Color.white.opacity(0.35), lineWidth: 1))
            .shadow(color: tint.opacity(0.5), radius: 8)
    }
}
