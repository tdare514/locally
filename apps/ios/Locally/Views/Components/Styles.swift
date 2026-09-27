import SwiftUI

/// Centralised look for every screen, matching `docs/design.md`. Screens
/// should reach for these instead of ad-hoc `.background`/`.padding`
/// combinations, so a token change here updates the whole app.

// MARK: - Buttons

/// "Import to Spotify" / "Send to Spotify": an `accent` pill with black bold
/// text, full width and 48 tall on mobile (per "Shape and spacing"), or a
/// small non-full-width pill (the crop sheet's "Done"). Press feedback:
/// scale to 0.95. Disabled: 50% opacity.
struct PrimaryPillButtonStyle: ButtonStyle {
    var isFullWidth: Bool = true
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Font.primaryButton)
            .foregroundStyle(Color.black)
            .padding(.horizontal, isFullWidth ? 0 : Theme.Spacing.primaryButtonH)
            .frame(maxWidth: isFullWidth ? .infinity : nil)
            .frame(height: isFullWidth ? 48 : 36)
            .background(Theme.accent)
            .clipShape(Capsule())
            .opacity(isEnabled ? 1 : 0.5)
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
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

/// "Cancel" / "Delete": no background, just coloured text that lightens to
/// white on press. `color` defaults to `text-muted`; pass `Theme.danger` for
/// a destructive text button (e.g. release detail's "Delete").
struct TextButtonStyle: ButtonStyle {
    var color: Color = Theme.secondaryText
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Font.body.weight(.semibold))
            .foregroundStyle(configuration.isPressed ? Theme.primaryText : color)
            .opacity(isEnabled ? 1 : 0.5)
    }
}

// MARK: - Fields

/// `elevated` background, radius 6, a 1 pt `border` always, plus a 2 pt
/// `accent` ring layered on top when focused (the border colour itself never
/// changes). Apply to a `TextField`/`SecureField` directly.
private struct FieldStyleModifier: ViewModifier {
    @FocusState private var isFocused: Bool

    func body(content: Content) -> some View {
        content
            .focused($isFocused)
            .font(Theme.Font.input)
            .foregroundStyle(Theme.primaryText)
            .padding(.horizontal, Theme.Spacing.inputPaddingH)
            .frame(minHeight: 48)
            .background(Theme.elevated)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.input))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.input)
                    .stroke(Theme.border, lineWidth: 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.input)
                    .stroke(Theme.accent, lineWidth: 2)
                    .opacity(isFocused ? 1 : 0)
            )
    }
}

extension View {
    /// A text input styled per `docs/design.md`'s "Text field" component.
    func fieldStyle() -> some View {
        modifier(FieldStyleModifier())
    }

    /// A drop-zone surface, as the cover picker and audio chooser draw
    /// themselves: `card` fill with a 1 pt dashed `border-dashed`, radius 8.
    func dropZone() -> some View {
        background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.dropZone))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.dropZone)
                    .strokeBorder(Theme.borderDashed, style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
            )
    }

    /// The section-eyebrow text style (e.g. "YOUR COLLECTION"): 11 pt bold
    /// uppercase, wide tracking, `accent` colour.
    func eyebrow() -> some View {
        font(Theme.Font.eyebrow)
            .tracking(11 * 0.18)
            .textCase(.uppercase)
            .foregroundStyle(Theme.accent)
    }

    /// The field-label text style (e.g. "TITLE"): 11 pt bold uppercase, wide
    /// tracking, muted colour.
    func fieldLabelStyle() -> some View {
        font(Theme.Font.fieldLabel)
            .tracking(11 * 0.14)
            .textCase(.uppercase)
            .foregroundStyle(Theme.secondaryText)
    }

    /// A list-container surface: `card` fill, radius 12, 1 pt `border` —
    /// used for the library list and other grouped-row containers.
    func cardContainer() -> some View {
        background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }
}

// MARK: - Sticky footer

/// Pins a full-width primary action to the bottom of the screen with a 1 pt
/// top `border` and 95% black material, via `.safeAreaInset` so the content
/// behind it scrolls underneath rather than being covered. Used by the
/// library ("Add a song"), the import screens ("Send to Spotify") and the
/// release detail screen ("Save changes").
private struct StickyFooter<Footer: View>: ViewModifier {
    @ViewBuilder let footer: () -> Footer

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                Rectangle()
                    .fill(Theme.border)
                    .frame(height: 1)
                footer()
                    .padding(.horizontal, Theme.Spacing.pagePadding)
                    .padding(.top, 12)
                    .padding(.bottom, 16)
            }
            .background {
                Color.black.opacity(0.95)
                    .background(.ultraThinMaterial)
            }
        }
    }
}

extension View {
    /// Wraps this view (typically a `ScrollView` or `List`) with a sticky
    /// bottom bar holding `footer`'s content — see `StickyFooter`.
    func stickyFooter<Footer: View>(@ViewBuilder footer: @escaping () -> Footer) -> some View {
        modifier(StickyFooter(footer: footer))
    }
}

// MARK: - File row

/// One track/audio file row, used by the album builder and the release
/// detail's Tracks section: a `card` with a 1 pt `border`, radius 8, min
/// height 64, a 36 pt `elevated` tile holding an accent `music.note` icon,
/// a title (editable or plain text) and the "Audio file" caption.
struct FileRow: View {
    let index: Int
    let title: String
    var isEditable: Bool = false
    var onTitleChange: (String) -> Void = { _ in }

    var body: some View {
        HStack(spacing: 12) {
            Text("\(index)")
                .font(Theme.Font.rowSubtitle)
                .foregroundStyle(Theme.textDim)
                .frame(width: 16, alignment: .trailing)

            ZStack {
                RoundedRectangle(cornerRadius: Theme.Radius.thumbnail)
                    .fill(Theme.elevated)
                Image(systemName: "music.note")
                    .foregroundStyle(Theme.accent)
            }
            .frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: 2) {
                if isEditable {
                    TextField(
                        Copy.Import.track,
                        text: Binding(get: { title }, set: onTitleChange)
                    )
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(Theme.primaryText)
                } else {
                    Text(title)
                        .font(Theme.Font.rowTitle)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(1)
                }
                Text(Copy.Import.audioFile)
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 64)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.fileRow))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.fileRow)
                .stroke(Theme.border, lineWidth: 1)
        )
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
