import SwiftUI

/// Plain text that becomes editable on tap: no box and no label. The placeholder is
/// `Theme.textDim`, and a hairline underline (one device pixel) shows only while focused.
struct InlineField: View {
    let placeholder: String
    @Binding var text: String
    var font: Font = Theme.Font.input

    @FocusState private var focused: Bool
    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ placeholder: String, text: Binding<String>, font: Font = Theme.Font.input) {
        self.placeholder = placeholder
        self._text = text
        self.font = font
    }

    var body: some View {
        TextField("", text: $text, prompt: Text(placeholder).foregroundColor(Theme.textDim))
            .font(font)
            .foregroundStyle(Theme.primaryText)
            .focused($focused)
            .submitLabel(.done)
            .padding(.bottom, Theme.Immersive.inlineFieldUnderlineGap)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(Theme.secondaryText.opacity(Theme.Immersive.inlineFieldUnderlineOpacity))
                    .frame(height: 1 / displayScale)
                    .opacity(focused ? 1 : 0)
            }
            .animation(reduceMotion ? nil : .easeInOut(duration: Theme.Immersive.inlineFieldFocusFade), value: focused)
    }
}

#if DEBUG
private struct InlineFieldPreview: View {
    @State private var empty = ""
    @State private var filled = "Midnight Drive"
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sectionGap) {
            InlineField("Title", text: $empty, font: Theme.Font.pageTitle)
            InlineField("Title", text: $filled, font: Theme.Font.pageTitle)
        }
        .padding(Theme.Spacing.pagePadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.background)
    }
}

#Preview("Inline field, empty and filled") {
    InlineFieldPreview()
}
#endif
