import SwiftUI

/// Settings' building blocks (#160, direction A "Glass groups"): a titled section holding a
/// faked-glass card whose rows carry a tinted icon tile. The glass is the release page's (a faint
/// white fill and a hairline stroke, no blur) with a light cool tint, a soft glow from the top edge
/// and an edge highlight that fades down the sides. All gradients; nothing samples the backdrop.

/// A section title in sentence case, the content, and an optional footnote underneath.
struct GlassSection<Content: View>: View {
    let title: String
    var footnote: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(Theme.ScaledFont.sectionTitle)
                .foregroundStyle(Theme.secondaryText)
                .padding(.horizontal, 6)
                .accessibilityAddTraits(.isHeader)
            content()
            if let footnote {
                Text(footnote)
                    .font(Theme.ScaledFont.caption)
                    .foregroundStyle(Theme.textHint)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 6)
            }
        }
    }
}

private let glassCornerRadius: CGFloat = 26

private struct GlassSurface: View {
    var prominent: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: glassCornerRadius, style: .continuous)
        shape
            .fill(Theme.Immersive.panelFill)
            .overlay(
                shape.fill(LinearGradient(
                    colors: [Theme.Tint.slate.opacity(prominent ? 0.14 : 0.08), Theme.Tint.slate.opacity(0.02)],
                    startPoint: .top, endPoint: .bottom
                ))
            )
            .overlay(
                shape.fill(RadialGradient(
                    colors: [.white.opacity(prominent ? 0.13 : 0.08), .clear],
                    center: UnitPoint(x: 0.3, y: 0), startRadius: 0, endRadius: 260
                ))
            )
            .overlay(
                shape.strokeBorder(
                    LinearGradient(
                        colors: [.white.opacity(0.26), .white.opacity(0.07), .white.opacity(0.02)],
                        startPoint: .top, endPoint: .bottom
                    ),
                    lineWidth: 1
                )
            )
    }
}

/// A faked-glass card. `prominent` is a little brighter, for the account hero.
struct GlassCard<Content: View>: View {
    var prominent = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: glassCornerRadius, style: .continuous))
        .background(GlassSurface(prominent: prominent))
    }
}

/// The line between two rows of a card.
struct GlassDivider: View {
    var body: some View {
        FadingHairline(peak: 0.10).padding(.horizontal, 16)
    }
}

/// A one-device-pixel line that fades to nothing at both ends, so it never reads as a hard edge.
struct FadingHairline: View {
    var peak: Double = 0.14
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        LinearGradient(
            stops: [
                .init(color: .white.opacity(0), location: 0),
                .init(color: .white.opacity(peak), location: 0.22),
                .init(color: .white.opacity(peak), location: 0.78),
                .init(color: .white.opacity(0), location: 1),
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(height: 1 / displayScale)
        .accessibilityHidden(true)
    }
}

/// A rounded-square icon tile: the glyph in a tint, on a soft gradient of the same tint.
struct IconTile: View {
    let symbol: String
    let tint: Color
    @ScaledMetric(relativeTo: .body) private var scaledSide: CGFloat = 30
    /// Grows with text, but stops short of taking the row at the largest sizes.
    private var side: CGFloat { min(scaledSide, 48) }

    var body: some View {
        RoundedRectangle(cornerRadius: side * 0.30, style: .continuous)
            .fill(LinearGradient(
                colors: [tint.opacity(0.34), tint.opacity(0.16)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ))
            .frame(width: side, height: side)
            .overlay(
                Image(systemName: symbol)
                    .font(.system(size: side * 0.50, weight: .semibold))
                    .foregroundStyle(tint)
            )
            .accessibilityHidden(true)
    }
}

/// One row of a glass card: an icon tile, a title and, on the right, a value, a "Buy"-style pill or
/// a chevron. At large text sizes the value drops under the title instead of clipping. Read by
/// VoiceOver as one element: title, then value.
struct GlassRow: View {
    let symbol: String
    let tint: Color
    let title: String
    var value: String?
    var chevron = false
    var destructive = false
    var pill: String?

    var body: some View {
        HStack(spacing: 14) {
            IconTile(symbol: symbol, tint: tint)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    titleText
                    Spacer(minLength: 8)
                    trailing
                }
                VStack(alignment: .leading, spacing: 4) {
                    titleText
                    trailing
                }
            }
            if chevron {
                LocallyIcon(.chevronRight, size: 20, relativeTo: .footnote)
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .frame(minHeight: 56)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var titleText: some View {
        Text(title)
            .font(Theme.ScaledFont.rowTitle)
            .foregroundStyle(destructive ? Theme.danger : Theme.primaryText)
            .multilineTextAlignment(.leading)
    }

    @ViewBuilder
    private var trailing: some View {
        if let value {
            Text(value)
                .font(Theme.ScaledFont.value)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.trailing)
        } else if let pill {
            Text(pill)
                .font(Theme.ScaledFont.pill)
                .foregroundStyle(Theme.Tint.accentText)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(Capsule().fill(Theme.accent.opacity(0.18)))
        }
    }
}

/// A row that dims softly while pressed; no hard highlight rectangle.
struct SoftPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Color.white.opacity(configuration.isPressed ? 0.07 : 0))
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// A text field for inside a glass card: a faint fill, no outline at rest and a soft accent ring
/// while typing. The label is for VoiceOver; the placeholder is what is drawn. Never capitalised or
/// autocorrected: it holds an email, a code or an address.
struct GlassField: View {
    let label: String
    var placeholder = ""
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var contentType: UITextContentType?
    @FocusState private var isFocused: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        TextField(placeholder, text: $text)
            .keyboardType(keyboardType)
            .textContentType(contentType)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($isFocused)
            .font(Theme.ScaledFont.input)
            .foregroundStyle(Theme.primaryText)
            .padding(.horizontal, 16)
            .frame(minHeight: 48)
            .background(shape.fill(Color.white.opacity(0.08)))
            .overlay(shape.strokeBorder(Theme.accent.opacity(0.8), lineWidth: 1.5).opacity(isFocused ? 1 : 0))
            .accessibilityLabel(label)
    }
}

/// One line (cut in the middle) at normal sizes, wrapping at accessibility sizes so an address is
/// never hidden.
private struct AddressLineLimit: ViewModifier {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func body(content: Content) -> some View {
        content
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 4 : 1)
            .truncationMode(.middle)
    }
}

extension View {
    func addressLineLimit() -> some View { modifier(AddressLineLimit()) }
}
