import SwiftUI

/// The fixed-size type roles of `Theme.Font`, as Dynamic Type roles (#226, `docs/design.md` "Type").
/// Each carries its size and weight at the default text size, and the text style it scales with.
enum ThemeFontRole {
    case pageTitle, sectionTitle, eyebrow, fieldLabel, input, body, rowTitle, rowSubtitle
    case meta, dropZoneLine, dropZoneHint, badge, primaryButton, chevron

    var size: CGFloat {
        switch self {
        case .pageTitle: 24
        case .sectionTitle: 18
        case .eyebrow, .fieldLabel: 13
        case .input: 16
        case .body, .meta, .rowSubtitle, .dropZoneLine: 14
        case .rowTitle, .primaryButton: 15
        case .dropZoneHint: 12
        case .badge: 10
        case .chevron: 13
        }
    }

    var weight: Font.Weight {
        switch self {
        case .pageTitle, .sectionTitle, .primaryButton: .bold
        case .input, .body, .rowSubtitle, .meta, .dropZoneHint: .regular
        case .eyebrow, .fieldLabel, .rowTitle, .badge, .chevron: .semibold
        case .dropZoneLine: .medium
        }
    }

    var style: Font.TextStyle {
        switch self {
        case .pageTitle: .title2
        case .sectionTitle: .title3
        case .badge: .caption2
        case .input, .rowTitle, .primaryButton: .body
        case .body, .meta, .rowSubtitle, .dropZoneLine: .subheadline
        case .eyebrow, .fieldLabel, .dropZoneHint, .chevron: .footnote
        }
    }
}

/// Applies a `ThemeFontRole`: the role's size scales with the reader's text size, relative to its style.
struct ThemeFontModifier: ViewModifier {
    let weight: Font.Weight
    @ScaledMetric private var size: CGFloat

    init(role: ThemeFontRole, weight: Font.Weight? = nil) {
        self.weight = weight ?? role.weight
        _size = ScaledMetric(wrappedValue: role.size, relativeTo: role.style)
    }

    func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight))
    }
}

extension View {
    /// `weight` overrides the role's weight (a role used one step heavier in a few places).
    func themeFont(_ role: ThemeFontRole, weight: Font.Weight? = nil) -> some View {
        modifier(ThemeFontModifier(role: role, weight: weight))
    }
}

/// Fills the screen like a plain stack (its spacers still push content apart), but scrolls once the
/// content grows taller than the screen at larger text sizes (#226).
struct ScrollsWhenCrowded: ViewModifier {
    func body(content: Content) -> some View {
        GeometryReader { proxy in
            ScrollView {
                content.frame(minHeight: proxy.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }
}

extension View {
    func scrollsWhenCrowded() -> some View {
        modifier(ScrollsWhenCrowded())
    }
}
