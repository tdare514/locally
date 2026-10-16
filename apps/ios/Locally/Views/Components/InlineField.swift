import SwiftUI

/// Plain text that becomes editable on tap: no box and no label. The placeholder is
/// `Theme.textDim`, and a hairline underline (one device pixel) shows only while focused.
struct InlineField: View {
    let placeholder: String
    @Binding var text: String
    var font: Font = Theme.Font.input
    /// Wraps onto up to four lines instead of truncating (the import's fields at large text).
    /// Return still ends editing; no newline ever reaches `text`.
    var wraps = false

    @FocusState private var focused: Bool
    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ placeholder: String, text: Binding<String>, font: Font = Theme.Font.input, wraps: Bool = false) {
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

    var body: some View {
        field
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
