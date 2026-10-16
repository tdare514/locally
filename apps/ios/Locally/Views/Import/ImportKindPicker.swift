import SwiftUI

/// The Single / Album switch on the import record (docs/design.md "Kind switch"): the Glow pill's
/// glass track, an icon and a word per option, and a thumb tinted with the cover's colour that
/// slides to the chosen option. At accessibility text sizes the options stack, so nothing truncates.
struct KindSwitch: View {
    @Binding var kind: ImportKind
    let tint: Color

    @Namespace private var thumbSpace
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private static let options: [(kind: ImportKind, icon: String, word: String)] = [
        (.single, "music.note", Copy.Import.kindSingle),
        (.album, "rectangle.stack.fill", Copy.Import.kindAlbum),
    ]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 0) { optionButtons(fill: false) }
            VStack(spacing: 0) { optionButtons(fill: true) }
        }
        .padding(3)
        .background { GlowGlass().clipShape(Capsule()) }
        .overlay { GlowRim() }
        .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.85), value: kind)
        .sensoryFeedback(.selection, trigger: kind)
        .opacity(isEnabled ? 1 : 0.5)
    }

    private func optionButtons(fill: Bool) -> some View {
        ForEach(Self.options, id: \.kind) { option in
            let chosen = kind == option.kind
            Button {
                kind = option.kind
            } label: {
                HStack(spacing: 6) {
                    // The icons step aside at the accessibility sizes, so both words fit side by side.
                    if !dynamicTypeSize.isAccessibilitySize {
                        Image(systemName: option.icon).accessibilityHidden(true)
                    }
                    Text(option.word)
                }
                .font(Theme.ScaledFont.subheadline.weight(.semibold))
                .foregroundStyle(Color.white.opacity(chosen ? 1 : 0.55))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                // A 44 pt tap target at every text size.
                .frame(maxWidth: fill ? .infinity : nil, minHeight: Theme.Import.kindSwitchMinTarget)
                .contentShape(Capsule())
                .background {
                    if chosen { thumb.matchedGeometryEffect(id: "thumb", in: thumbSpace) }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(option.word)
            .accessibilityAddTraits(chosen ? .isSelected : [])
        }
    }

    private var thumb: some View {
        // A dark base under the tint keeps the white label at 4.5:1 or better on a bright colour.
        Capsule()
            .fill(Color.black.opacity(Theme.Import.kindThumbBase))
            .overlay(Capsule().fill(tint.opacity(0.55)))
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.35), lineWidth: 1))
            .shadow(color: tint.opacity(0.5), radius: 8)
    }
}
