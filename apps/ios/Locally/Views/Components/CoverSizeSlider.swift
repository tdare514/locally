import SwiftUI

/// The Library's cover size control (#360): a thin track with three detents, a round glass thumb, a
/// dense-grid glyph at the left end and a big-grid glyph at the right. Drag or tap to move it; it
/// snaps to a detent on the house easing, with a selection haptic per detent. VoiceOver reads it as
/// an adjustable "Cover size, Medium".
struct CoverSizeSlider: View {
    @Binding var selection: CoverSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var scaledThumb = Theme.Library.sizeSliderThumb
    /// Grows a little with the text but stays inside the 44 pt hit height.
    private var thumb: CGFloat { min(scaledThumb, Theme.Library.sizeSliderHeight - 8) }

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
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Theme.Immersive.panelStroke)
                    .frame(height: Theme.Library.sizeSliderTrack)
                ForEach(sizes, id: \.self) { size in
                    Circle()
                        .fill(Theme.textDim)
                        .frame(width: 5, height: 5)
                        .offset(x: inset + span * CGFloat(size.rawValue) / last - 2.5)
                }
                Circle()
                    .fill(LinearGradient(colors: [.white.opacity(0.55), .white.opacity(0.22)], startPoint: .top, endPoint: .bottom))
                    .overlay(Circle().stroke(.white.opacity(0.6), lineWidth: 1))
                    .shadow(color: .black.opacity(0.35), radius: 4, y: 2)
                    .frame(width: thumb, height: thumb)
                    .offset(x: span * CGFloat(selection.rawValue) / last)
                    .animation(reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: Theme.Library.sizeSliderSnapDuration), value: selection)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { value in
                    let fraction = (value.location.x - inset) / span
                    let index = Int((fraction * last).rounded())
                    if let size = CoverSize(rawValue: min(max(index, 0), sizes.count - 1)) { selection = size }
                }
            )
        }
    }

    private func move(by step: Int) {
        if let size = CoverSize(rawValue: selection.rawValue + step) { selection = size }
    }
}
