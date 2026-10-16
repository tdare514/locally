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
                    Image(systemName: option.icon).accessibilityHidden(true)
                    Text(option.word)
                }
                .font(Theme.ScaledFont.subheadline.weight(.semibold))
                .foregroundStyle(Color.white.opacity(chosen ? 1 : 0.55))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .frame(maxWidth: fill ? .infinity : nil)
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
        Capsule()
            .fill(Color.white.opacity(0.12))
            .overlay(Capsule().fill(tint.opacity(0.55)))
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.35), lineWidth: 1))
            .shadow(color: tint.opacity(0.5), radius: 8)
    }
}
