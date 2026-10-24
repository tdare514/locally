import SwiftUI

/// The Library's cover size control (#360): a glass track (the Glow switch's glass and rim) with three
/// detent dots, a round thumb in the Glow switch's tinted glass with a small highlight, a dense-grid glyph
/// at the left end and a big-grid glyph at the right. Drag or tap to move it; the thumb follows on the Glow
/// switch's spring, with a selection haptic per detent. VoiceOver reads it as an adjustable "Cover size, Medium".
struct CoverSizeSlider: View {
    @Binding var selection: CoverSize
    /// The library sky's colour (the cover's glow colour; the accent with no cover).
    var tint: Color = Theme.accent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var scaledThumb = Theme.Library.sizeSliderThumb
    /// Grows a little with the text but stays within 36 pt and inside the 44 pt hit height.
    private var thumb: CGFloat { min(scaledThumb, Theme.Library.sizeSliderThumbMax, Theme.Library.sizeSliderHeight - 8) }

    private var sizes: [CoverSize] { CoverSize.allCases }

    var body: some View {
        HStack(spacing: 6) {
            glyph("square.grid.3x3")
            track
            glyph("square.grid.2x2")
        }
        .frame(width: Theme.Library.sizeSliderWidth, height: Theme.Library.sizeSliderHeight)
        .sensoryFeedback(.selection, trigger: selection)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Copy.Library.coverSizeLabel)
        .accessibilityValue(Copy.Library.coverSizeName(selection))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: move(by: 1)
            case .decrement: move(by: -1)
            @unknown default: break
            }
        }
    }

    private func glyph(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: Theme.Library.sizeSliderGlyph, weight: .semibold))
            .foregroundStyle(Theme.secondaryText)
            .accessibilityHidden(true)
    }

    private var track: some View {
        GeometryReader { proxy in
            let inset = thumb / 2
            let span = max(proxy.size.width - thumb, 1)
            let last = CGFloat(sizes.count - 1)
            let dot = Theme.Library.sizeSliderDetent
            ZStack(alignment: .leading) {
                GlowGlass()
                    .clipShape(Capsule())
                    .overlay { GlowRim() }
                    .frame(height: Theme.Library.sizeSliderTrack)
                ForEach(sizes, id: \.self) { size in
                    Circle()
                        .fill(Color.white.opacity(Theme.Library.sizeSliderDetentOpacity))
                        .frame(width: dot, height: dot)
                        .offset(x: inset + span * CGFloat(size.rawValue) / last - dot / 2)
                }
                TintedGlassThumb(shape: Circle(), tint: tint, specular: true)
                    .frame(width: thumb, height: thumb)
                    .offset(x: span * CGFloat(selection.rawValue) / last)
                    .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.85), value: selection)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { value in
                    selection = CoverSize.nearest(fraction: (value.location.x - inset) / span)
                }
            )
        }
    }

    private func move(by step: Int) {
        selection = selection.stepped(by: step)
    }
}
