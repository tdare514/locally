import SwiftUI

/// Centralised look for every screen, matching `docs/design.md`. Screens
/// should reach for these instead of ad-hoc `.background`/`.padding`
/// combinations, so a token change here updates the whole app.

// MARK: - Buttons

/// "Import to Spotify" / "Send to Spotify": an `accent` pill with black bold
/// text. Disabled state is 40% opacity with no other colour change.
struct PrimaryPillButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Font.primaryButton)
            .foregroundStyle(Color.black)
            .padding(.horizontal, Theme.Spacing.primaryButtonH)
            .padding(.vertical, Theme.Spacing.primaryButtonV)
            .background(Theme.accent)
            .clipShape(Capsule())
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.4)
    }
}

/// "Settings" / "Show in Finder"-style secondary actions: an `elevated`
/// pill with a `text` (or `danger`, for destructive actions) label.
struct SecondaryPillButtonStyle: ButtonStyle {
    var isDestructive: Bool = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Font.body.weight(.medium))
            .foregroundStyle(isDestructive ? Theme.danger : Theme.primaryText)
            .padding(.horizontal, Theme.Spacing.primaryButtonH)
            .padding(.vertical, Theme.Spacing.primaryButtonV)
            .background(Theme.elevated)
            .clipShape(Capsule())
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.5)
    }
}

// MARK: - Fields

/// `elevated` background, 1 px `border`, switching to `accent` on focus —
/// nothing else changes. Apply to a `TextField`/`SecureField` directly.
private struct FieldStyleModifier: ViewModifier {
    @FocusState private var isFocused: Bool

    func body(content: Content) -> some View {
        content
            .focused($isFocused)
            .font(Theme.Font.body)
            .foregroundStyle(Theme.primaryText)
            .padding(.horizontal, Theme.Spacing.inputPaddingH)
            .padding(.vertical, Theme.Spacing.inputPaddingV)
            .background(Theme.elevated)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.input))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.input)
                    .stroke(isFocused ? Theme.accent : Theme.border, lineWidth: 1)
            )
    }
}

extension View {
    /// A text input styled per `docs/design.md`'s "Text field" component.
    func fieldStyle() -> some View {
        modifier(FieldStyleModifier())
    }

    /// A `panel` block with radius 8: the cover placeholder, drop zones,
    /// and other card-like groupings.
    func panelCard() -> some View {
        background(Theme.panel)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.panel))
    }

    /// A drop-zone surface, as the web app draws the cover placeholder and
    /// the audio chooser: `elevated` fill with a 2 pt dashed `border`,
    /// radius 8.
    func dropZone() -> some View {
        background(Theme.elevated)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.panel))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.panel)
                    .strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
            )
    }

    /// The section-eyebrow text style (e.g. "LIBRARY"): 12 pt semibold
    /// uppercase, wide tracking, muted colour.
    func eyebrow() -> some View {
        font(Theme.Font.eyebrow)
            .tracking(1.2)
            .textCase(.uppercase)
            .foregroundStyle(Theme.secondaryText)
    }
}

// MARK: - Kind badge

/// SINGLE / ALBUM badge: an `elevated` pill in the badge text style.
struct KindBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.Font.badge)
            .tracking(1.0)
            .textCase(.uppercase)
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Theme.elevated)
            .clipShape(Capsule())
    }
}
