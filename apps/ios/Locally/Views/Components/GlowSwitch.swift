import SwiftUI

/// The Import screen's Single / Album switch, for any set of options (docs/design.md "Kind switch"):
/// the Glow pill's glass track, an optional icon and a word per option, and a thumb tinted with
/// `tint` that slides to the chosen option. Every option is a 44 pt target. At accessibility text
/// sizes the icons step aside. When the options are wider than the room, `.stack` puts them in a
/// column and `.scroll` scrolls them sideways (the chosen one kept in view, the edges faded).
struct GlowSwitch<Value: Hashable>: View {
    enum Overflow { case stack, scroll }

    let options: [(value: Value, icon: String?, label: String)]
    @Binding var selection: Value
    let tint: Color
    var compact = false
    var overflow: Overflow = .stack

    @Namespace private var thumbSpace
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private static var fade: CGFloat { 14 }

    var body: some View {
        Group {
            switch overflow {
            case .stack:
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 0) { optionButtons(fill: false) }
                    VStack(spacing: 0) { optionButtons(fill: true) }
                }
            case .scroll:
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 0) { optionButtons(fill: false) }
                    scroller
                }
            }
        }
        .padding(3)
        .background { GlowGlass().clipShape(Capsule()) }
        .overlay { GlowRim() }
        .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.85), value: selection)
        .sensoryFeedback(.selection, trigger: selection)
        .opacity(isEnabled ? 1 : 0.5)
    }

    private var scroller: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) { optionButtons(fill: false) }
            }
            .mask {
                HStack(spacing: 0) {
                    LinearGradient(colors: [.clear, .black], startPoint: .leading, endPoint: .trailing).frame(width: Self.fade)
                    Rectangle().fill(.black)
                    LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing).frame(width: Self.fade)
                }
            }
            .onAppear { proxy.scrollTo(selection, anchor: .center) }
            .onChange(of: selection) { _, value in
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) { proxy.scrollTo(value, anchor: .center) }
            }
        }
    }

    private func optionButtons(fill: Bool) -> some View {
        ForEach(options, id: \.value) { option in
            let chosen = selection == option.value
            Button {
                selection = option.value
            } label: {
                HStack(spacing: 6) {
                    // The icons step aside at the accessibility sizes, so the words fit.
                    if let icon = option.icon, !dynamicTypeSize.isAccessibilitySize {
                        Image(systemName: icon).accessibilityHidden(true)
                    }
                    Text(option.label)
                }
                .font(Theme.ScaledFont.subheadline.weight(.semibold))
                .foregroundStyle(Color.white.opacity(chosen ? 1 : 0.55))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, compact ? 9 : 14)
                .padding(.vertical, 8)
                // A 44 pt tap target at every text size.
                .frame(maxWidth: fill ? .infinity : nil, minHeight: Theme.Import.kindSwitchMinTarget)
                .contentShape(Capsule())
                .background {
                    if chosen { thumb.matchedGeometryEffect(id: "thumb", in: thumbSpace) }
                }
            }
            .buttonStyle(.plain)
            .id(option.value)
            .accessibilityLabel(option.label)
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
