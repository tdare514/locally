import SwiftUI

/// The Single/Album switch on the Import tab: a pill track in `elevated`
/// with 4 pt padding; the selected segment is an `accent` pill with black
/// semibold text, the others `text-muted` text on nothing. The system
/// `.segmented` picker style can't produce this look (no per-segment fill
/// control), so this is a small custom replacement — same single-selection
/// behaviour, just drawn by hand.
struct SegmentedPill<Value: Hashable>: View {
    let options: [(value: Value, label: String)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.value) { option in
                Button {
                    selection = option.value
                } label: {
                    Text(option.label)
                        .font(Theme.Font.body.weight(.semibold))
                        .foregroundStyle(selection == option.value ? Color.black : Theme.secondaryText)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                        .background {
                            if selection == option.value {
                                Capsule().fill(Theme.accent)
                            }
                        }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Theme.elevated)
        .clipShape(Capsule())
    }
}
