import SwiftUI

/// The Single/Album switch on the Import tab (and, compact, the Square |
/// Original switch in the crop sheet): a pill track in `elevated` with
/// padding; the selected segment is an `accent` pill with black semibold
/// text and a faint shadow, others `text-muted` text on nothing. The system
/// `.segmented` picker style can't produce this look (no per-segment fill
/// control), so this is a small custom replacement — same single-selection
/// behaviour, just drawn by hand.
struct SegmentedPill<Value: Hashable>: View {
    let options: [(value: Value, label: String)]
    @Binding var selection: Value
    /// The crop sheet uses a smaller variant: 2 pt track padding, 14 pt
    /// text, tighter segment padding.
    var isCompact: Bool = false
    /// A taller segment, for screens that need 44 pt touch targets (Stats). 0 keeps the text's own height.
    var minSegmentHeight: CGFloat = 0
    /// Lets the labels follow Dynamic Type (Stats). Off keeps the fixed 14 pt of the Import and crop screens.
    var scalesText = false
    @ScaledMetric(relativeTo: .footnote) private var scaledText: CGFloat = 14
    @Environment(\.isEnabled) private var isEnabled

    private var trackPadding: CGFloat { isCompact ? 2 : 4 }
    private var segmentPaddingH: CGFloat { isCompact ? 12 : 16 }
    private var segmentPaddingV: CGFloat { 6 }
    private var textSize: CGFloat { scalesText ? scaledText : 14 }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.value) { option in
                Button {
                    selection = option.value
                } label: {
                    Text(option.label)
                        .font(.system(size: textSize, weight: .semibold))
                        .foregroundStyle(selection == option.value ? Color.black : Theme.secondaryText)
                        .padding(.horizontal, segmentPaddingH)
                        .padding(.vertical, segmentPaddingV)
                        .frame(minHeight: minSegmentHeight)
                        .background {
                            if selection == option.value {
                                Capsule()
                                    .fill(Theme.accent)
                                    .shadow(color: .black.opacity(0.25), radius: 3, x: 0, y: 1)
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == option.value ? .isSelected : [])
            }
        }
        .padding(trackPadding)
        .opacity(isEnabled ? 1 : 0.5)
        .background(Theme.elevated)
        .clipShape(Capsule())
    }
}
