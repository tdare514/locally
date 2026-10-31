import SwiftUI

/// One choice of an `IconToggle`: the value it sets, the spoken label, and a glyph drawn at the size it is given.
/// The toggle colours the glyph (chosen `primaryText`, the rest `secondaryText`), so a glyph meant to follow that
/// is a template: `LocallyIcon`, or shapes drawn with the inherited foreground style.
struct IconToggleOption<Value: Hashable> {
    let value: Value
    let label: String
    let glyph: (CGFloat) -> AnyView

    init<Glyph: View>(_ value: Value, label: String, @ViewBuilder glyph: @escaping (CGFloat) -> Glyph) {
        self.value = value
        self.label = label
        self.glyph = { AnyView(glyph($0)) }
    }

    /// A hand-drawn glyph from the `Icon/…` set (#213, #412).
    init(_ value: Value, icon: LocallyIcon.Name, label: String) {
        self.init(value, label: label) { LocallyIcon(icon, size: $0, scaled: false) }
    }
}

/// The sizes an `IconToggle` and the controls beside it share, scaling with Dynamic Type (#226): `scaled` is a
/// `@ScaledMetric` of `Theme.Library.toggleIconSize` or `toggleButtonSize`.
enum IconToggleMetrics {
    static func iconSize(scaled: CGFloat) -> CGFloat { min(scaled, Theme.Library.toggleIconMaxSize) }
    /// The hand-drawn glyphs sit a little smaller in their box than SF Symbols, so they get 3 pt more, still under the 35 pt cap.
    static func drawnIconSize(scaled: CGFloat) -> CGFloat { min(iconSize(scaled: scaled) + 3, Theme.Library.toggleIconMaxSize) }
    static func buttonSize(scaled: CGFloat) -> CGFloat { min(scaled, Theme.Library.toggleButtonMaxSize) }
}

/// The icon toggle for a two- or three-way choice: the Library's list / grid / artists (#213) and the Collections
/// view and record switches (#444). An `elevated` capsule track with a thumb a step lighter (`elevated-hover`) that
/// slides to the chosen option (a spring, none under Reduce Motion), one icon per option, `primaryText` for the chosen
/// one and `secondaryText` for the rest. Every option is at least a 44 pt target.
struct IconToggle<Value: Hashable>: View {
    let options: [IconToggleOption<Value>]
    @Binding var selection: Value
    /// The spoken name of the whole group, e.g. "View".
    let label: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var thumbSpace
    @ScaledMetric(relativeTo: .body) private var scaledIconSize = Theme.Library.toggleIconSize
    @ScaledMetric(relativeTo: .body) private var scaledButtonSize = Theme.Library.toggleButtonSize

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.value) { option in button(option) }
        }
        .background(Theme.elevated, in: Capsule())
        .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.85), value: selection)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private func button(_ option: IconToggleOption<Value>) -> some View {
        let selected = selection == option.value
        let side = max(IconToggleMetrics.buttonSize(scaled: scaledButtonSize), Theme.Spacing.minTarget)
        return Button {
            selection = option.value
        } label: {
            option.glyph(IconToggleMetrics.drawnIconSize(scaled: scaledIconSize))
                .foregroundStyle(selected ? Theme.primaryText : Theme.secondaryText)
                .frame(width: side, height: side)
                .background {
                    if selected {
                        Capsule()
                            .fill(Theme.elevatedHover)
                            .padding(Theme.Library.toggleThumbInset)
                            .matchedGeometryEffect(id: "thumb", in: thumbSpace)
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
