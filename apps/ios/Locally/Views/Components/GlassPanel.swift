import SwiftUI

/// The faked-glass panel from the web's `.glass-fake`: a white gradient fill, an inset
/// hairline and a top highlight, with no blur or material.
struct GlassPanel: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Immersive.glassCornerRadius, style: .continuous)
        content
            .background {
                if reduceTransparency {
                    shape.fill(Theme.Immersive.glassSolid)
                } else {
                    shape
                        .fill(LinearGradient(
                            stops: [
                                .init(color: .white.opacity(Theme.Immersive.glassFillTop), location: 0),
                                .init(color: .white.opacity(Theme.Immersive.glassFillBottom), location: Theme.Immersive.glassFillStop),
                                .init(color: .white.opacity(Theme.Immersive.glassFillBottom), location: 1)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ))
                        .shadow(
                            color: .black.opacity(Theme.Immersive.glassShadowOpacity),
                            radius: Theme.Immersive.glassShadowRadius,
                            y: Theme.Immersive.glassShadowY
                        )
                }
            }
            .overlay {
                shape.strokeBorder(.white.opacity(Theme.Immersive.glassHairlineOpacity), lineWidth: 1)
            }
            .overlay(alignment: .top) {
                if !reduceTransparency {
                    // The 1 px top highlight, fading out toward the corners.
                    LinearGradient(
                        colors: [.clear, .white.opacity(Theme.Immersive.glassHighlightOpacity), .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(height: 1)
                    .padding(.horizontal, Theme.Immersive.glassCornerRadius)
                }
            }
    }
}

extension View {
    func glassPanel() -> some View {
        modifier(GlassPanel())
    }
}
