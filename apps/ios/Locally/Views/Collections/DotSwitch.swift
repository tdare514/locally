import SwiftUI

/// Plain words with a small accent dot under the chosen one (the Mac's segmented words, `docs/design-previews/339/`).
/// Each option is a button with a 44 pt hit area; the chosen one carries `.isSelected` and the group reads its name.
/// The text stops growing at `xxxLarge`, like the Library's toggle, so the row stays compact.
struct DotSwitch<Value: Hashable>: View {
    let name: String
    let options: [(value: Value, label: String)]
    @Binding var selection: Value
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.value) { option in
                let chosen = selection == option.value
                Button {
                    selection = option.value
                } label: {
                    VStack(spacing: 3) {
                        Text(option.label)
                            .themeFont(.body)
                            .foregroundStyle(chosen ? Theme.primaryText : Theme.secondaryText)
                            .lineLimit(1)
                        Circle()
                            .fill(Theme.accent)
                            .frame(width: 5, height: 5)
                            .opacity(chosen ? 1 : 0)
                    }
                    .padding(.horizontal, 6)
                    .frame(minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(option.label)
                .accessibilityAddTraits(chosen ? .isSelected : [])
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: Theme.Immersive.wheelTagFadeDuration), value: selection)
        .sensoryFeedback(.selection, trigger: selection)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(name)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
}
