import SwiftUI

/// A record field with its label at the leading edge (above the value at accessibility sizes) and a
/// hairline underline that is always visible: faint at rest, stronger while focused. `wraps` keeps
/// `InlineField`'s behaviour: up to four lines, Return ends editing, no newline reaches `text`.
struct LabeledField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var font: Font = Theme.ScaledFont.input
    var wraps = false

    @FocusState private var focused: Bool
    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .subheadline) private var labelWidth = Theme.Immersive.labeledFieldLabelWidth

    init(_ label: String, placeholder: String, text: Binding<String>, font: Font = Theme.ScaledFont.input, wraps: Bool = false) {
        self.label = label
        self.placeholder = placeholder
        self._text = text
        self.font = font
        self.wraps = wraps
    }

    @ViewBuilder
    private var field: some View {
        if wraps {
            TextField("", text: Binding(get: { text }, set: { setWrapped($0) }), prompt: Text(placeholder).foregroundColor(Theme.textDim), axis: .vertical)
                .lineLimit(1...4)
        } else {
            TextField("", text: $text, prompt: Text(placeholder).foregroundColor(Theme.textDim))
        }
    }

    /// A vertical field inserts a newline on Return: strip it and end editing instead.
    private func setWrapped(_ newValue: String) {
        guard newValue.contains(where: \.isNewline) else {
            text = newValue
            return
        }
        text = String(newValue.filter { !$0.isNewline })
        focused = false
    }

    private var value: some View {
        field
            .font(font)
            .foregroundStyle(Theme.primaryText)
            .focused($focused)
            .submitLabel(.done)
            .accessibilityLabel(label)
            .accessibilityValue(text)
            .padding(.bottom, Theme.Immersive.inlineFieldUnderlineGap)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(focused
                        ? Theme.secondaryText.opacity(Theme.Immersive.inlineFieldUnderlineOpacity)
                        : Color.white.opacity(Theme.Immersive.labeledFieldUnderlineRestOpacity))
                    .frame(height: 1 / displayScale)
            }
            .animation(reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: Theme.Immersive.inlineFieldFocusFade), value: focused)
    }

    private var labelText: some View {
        Text(label)
            .font(Theme.ScaledFont.subheadline)
            .foregroundStyle(Theme.secondaryText)
            .accessibilityHidden(true)
    }

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 0) {
                labelText
                value
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Immersive.labeledFieldLabelGap) {
                labelText.frame(width: labelWidth, alignment: .leading)
                value
            }
        }
    }
}

#if DEBUG
private struct LabeledFieldPreview: View {
    @State private var empty = ""
    @State private var filled = "Midnight Drive"
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Immersive.labeledFieldRowGap) {
            LabeledField("Title", placeholder: "Enter single name", text: $filled, font: Theme.ScaledFont.fieldTitle)
            LabeledField("Artist", placeholder: "Enter artist name", text: $empty)
        }
        .padding(Theme.Spacing.pagePadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.background)
    }
}

#Preview("Labeled field") {
    LabeledFieldPreview()
}
#endif
