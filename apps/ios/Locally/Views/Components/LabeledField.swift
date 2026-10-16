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
    /// The label takes only its own width instead of the shared column (Genre beside Year).
    var labelFits = false
    /// A fixed width for the value (Year beside Genre); nil fills the row.
    var valueWidth: CGFloat?
    /// The text style `font` is built on, for the first-baseline metric below.
    var metricsStyle: UIFont.TextStyle = .body

    @FocusState private var focused: Bool
    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .subheadline) private var labelWidth = Theme.Immersive.labeledFieldLabelWidth

    init(_ label: String, placeholder: String, text: Binding<String>, font: Font = Theme.ScaledFont.input, metricsStyle: UIFont.TextStyle = .body, wraps: Bool = false, labelFits: Bool = false, valueWidth: CGFloat? = nil) {
        self.label = label
        self.placeholder = placeholder
        self._text = text
        self.font = font
        self.metricsStyle = metricsStyle
        self.wraps = wraps
        self.labelFits = labelFits
        self.valueWidth = valueWidth
    }

    /// Where the value's first line sits, from the font itself. An empty vertical TextField
    /// reports its first baseline at the top, which lifted the label a line above "Enter genre";
    /// this gives every field, empty or not, the same baseline for the label to align to.
    private var firstBaseline: CGFloat {
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(dynamicTypeSize))
        return UIFont.preferredFont(forTextStyle: metricsStyle, compatibleWith: traits).ascender
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
            .alignmentGuide(.firstTextBaseline) { _ in firstBaseline }
            .font(font)
            .foregroundStyle(Theme.primaryText)
            .focused($focused)
            .submitLabel(.done)
            .accessibilityLabel(label)
            .accessibilityValue(text)
            .padding(.bottom, Theme.Immersive.inlineFieldUnderlineGap)
            // Two stacked hairlines, the focused one faded in over the resting one, so only
            // opacity animates.
            .overlay(alignment: .bottom) {
                ZStack {
                    Rectangle()
                        .fill(Color.white.opacity(Theme.Immersive.labeledFieldUnderlineRestOpacity))
                    Rectangle()
                        .fill(Theme.secondaryText.opacity(Theme.Immersive.inlineFieldUnderlineOpacity))
                        .opacity(focused ? 1 : 0)
                }
                .frame(height: 1 / displayScale)
            }
            .animation(reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: Theme.Immersive.inlineFieldFocusFade), value: focused)
    }

    private var labelText: some View {
        Text(label)
            .font(Theme.ScaledFont.subheadline)
            .foregroundStyle(Theme.secondaryText)
            .contentShape(Rectangle())
            // Tapping the label edits its field, as tapping the value does.
            .onTapGesture { focused = true }
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
                if labelFits {
                    labelText.fixedSize()
                } else {
                    labelText.frame(width: labelWidth, alignment: .leading)
                }
                value.frame(width: valueWidth, alignment: .leading)
            }
        }
    }
}

/// Year and Genre share one row (owner, 16 Oct 2026): Year in the label column like the rows
/// above it, Genre after it taking the rest. From XX Large text up they are two rows, since
/// Genre's half of the row then got so narrow that words broke ("Synth-").
struct YearGenreRow: View {
    @Binding var year: String
    @Binding var genre: String

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var yearValueWidth = Theme.Immersive.yearValueWidth

    private var stacks: Bool { dynamicTypeSize >= .xxLarge }

    private var yearField: some View {
        LabeledField(Copy.Import.fieldYear, placeholder: Copy.Import.yearPlaceholder, text: $year, font: Theme.ScaledFont.input,
                     valueWidth: stacks ? nil : yearValueWidth)
            .keyboardType(.numberPad)
    }

    private func genreField(labelFits: Bool) -> some View {
        LabeledField(Copy.Import.fieldGenre, placeholder: Copy.Import.genrePlaceholder, text: $genre, font: Theme.ScaledFont.input,
                     wraps: true, labelFits: labelFits)
    }

    var body: some View {
        if stacks {
            VStack(alignment: .leading, spacing: Theme.Immersive.labeledFieldRowGap) {
                yearField
                genreField(labelFits: false)
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Immersive.yearGenreGap) {
                yearField
                genreField(labelFits: true)
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
            LabeledField("Title", placeholder: "Enter single name", text: $filled, font: Theme.ScaledFont.fieldTitle, metricsStyle: .title3)
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
