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
    @Environment(\.isEnabled) private var isEnabled

    private var trackPadding: CGFloat { isCompact ? 2 : 4 }
    private var segmentPaddingH: CGFloat { isCompact ? 12 : 16 }
    private var segmentPaddingV: CGFloat { 6 }

    var body: some View {
        // One row while the words fit; otherwise the segments stack, each still a full target.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 0) { segments(fixedWidth: true) }
            VStack(spacing: Theme.Spacing.segmentRowGap) { segments(fixedWidth: false) }
        }
        .padding(trackPadding)
        .opacity(isEnabled ? 1 : 0.5)
        .background(Theme.elevated)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Spacing.segmentMinHeight / 2 + trackPadding))
    }

    private func segments(fixedWidth: Bool) -> some View {
        ForEach(options, id: \.value) { option in
            let isSelected = selection == option.value
            Button {
                selection = option.value
            } label: {
                Text(option.label)
                    .themeFont(.body, weight: .semibold)
                    .foregroundStyle(isSelected ? Color.black : Theme.secondaryText)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: true)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, segmentPaddingH)
                    .padding(.vertical, segmentPaddingV)
                    .frame(maxWidth: fixedWidth ? nil : .infinity, minHeight: Theme.Spacing.segmentMinHeight)
                    .background {
                        if isSelected {
                            Capsule()
                                .fill(Theme.accent)
                                .shadow(color: .black.opacity(0.25), radius: 3, x: 0, y: 1)
                        }
                    }
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(isSelected ? .isSelected : [])
        }
    }
}
