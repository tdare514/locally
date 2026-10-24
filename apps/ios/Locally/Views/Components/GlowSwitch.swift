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
    private static var padding: CGFloat { Theme.Import.kindSwitchPadding }
    private static var stackCorner: CGFloat { Theme.Import.kindSwitchStackCorner }
    private static var thumbCorner: CGFloat { stackCorner - padding }

    var body: some View {
        Group {
            switch overflow {
            case .stack:
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 0) { optionButtons(fill: false) }
                        .padding(Self.padding)
                        .background { GlowGlass().clipShape(Capsule()) }
                        .overlay { GlowRim() }
                    // A tall capsule's ends are round by half its width, so a column gets a bounded corner.
                    VStack(spacing: 0) { optionButtons(fill: true) }
                        .padding(Self.padding)
                        .background { GlowGlass().clipShape(RoundedRectangle(cornerRadius: Self.stackCorner, style: .continuous)) }
                        .overlay { GlowRim(corner: Self.stackCorner) }
                }
            case .scroll:
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 0) { optionButtons(fill: false) }
                        .padding(Self.padding)
                        .background { GlowGlass().clipShape(Capsule()) }
                        .overlay { GlowRim() }
                    scroller
                        .padding(Self.padding)
                        .background { GlowGlass().clipShape(Capsule()) }
                        .overlay { GlowRim() }
                }
            }
        }
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
                        if let mac = LocallyIcon.Name(rawValue: icon) {
                            // A Mac glyph (`Icon/…`) rather than an SF Symbol.
                            LocallyIcon(mac, size: 19, relativeTo: .subheadline)
                        } else {
                            Image(systemName: icon).accessibilityHidden(true)
                        }
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
                .contentShape(optionShape(fill: fill))
                .background {
                    if chosen { thumb(fill: fill).matchedGeometryEffect(id: "thumb", in: thumbSpace) }
                }
            }
            .buttonStyle(.plain)
            .id(option.value)
            .accessibilityLabel(option.label)
            .accessibilityAddTraits(chosen ? .isSelected : [])
        }
    }

    /// The thumb's and tap area's shape: a capsule in a row, a concentric rounded rectangle in the column.
    private func optionShape(fill: Bool) -> AnyShape {
        fill ? AnyShape(RoundedRectangle(cornerRadius: Self.thumbCorner, style: .continuous)) : AnyShape(Capsule())
    }

    private func thumb(fill: Bool) -> some View {
        let shape = optionShape(fill: fill)
        // A dark base under the tint keeps the white label at 4.5:1 or better on a bright colour.
        return shape
            .fill(Color.black.opacity(Theme.Import.kindThumbBase))
            .overlay(shape.fill(tint.opacity(0.55)))
            // AnyShape is not insettable: a 2 pt stroke clipped to the shape is a 1 pt inside border.
            .overlay(shape.stroke(Color.white.opacity(0.35), lineWidth: 2).clipShape(shape))
            .shadow(color: tint.opacity(0.5), radius: 8)
    }
}
