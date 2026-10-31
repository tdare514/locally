import SwiftUI

/// The slim neutral switch for a two- or three-way choice (docs/design.md "Design rules (30 Oct 2026)",
/// rule 6): the Import record's Single / Album, the Collections and Stats layouts, the date sheet's
/// Year / Month / Day, the crop sheet's Square / Original. A slim `elevated` track with a thumb a step
/// lighter (`elevated-hover`) that slides to the chosen option, an optional icon and a word per option,
/// white for the chosen one. The cover's colours never reach it: no tint, rim, glow or shadow. The track is
/// 44 pt high at the default text size and every option is a 44 pt target. At accessibility text sizes the
/// icons step aside. When the options are wider than the room, `.stack` puts them in a column and
/// `.scroll` scrolls them sideways (the chosen one kept in view, the edges faded).
struct SlimSwitch<Value: Hashable>: View {
    enum Overflow { case stack, scroll }

    let options: [(value: Value, icon: String?, label: String)]
    @Binding var selection: Value
    var compact = false
    var overflow: Overflow = .stack

    @Namespace private var thumbSpace
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private static var fade: CGFloat { 14 }
    private static var inset: CGFloat { Theme.Import.kindSwitchPadding }
    private static var stackCorner: CGFloat { Theme.Import.kindSwitchStackCorner }

    var body: some View {
        Group {
            switch overflow {
            case .stack:
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 0) { optionButtons(fill: false) }
                        .background(Theme.elevated, in: Capsule())
                    // A tall capsule's ends are round by half its width, so a column gets a bounded corner.
                    VStack(spacing: 0) { optionButtons(fill: true) }
                        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Self.stackCorner, style: .continuous))
                }
            case .scroll:
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 0) { optionButtons(fill: false) }
                        .background(Theme.elevated, in: Capsule())
                    scroller
                        .background(Theme.elevated, in: Capsule())
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
                // 4.5:1 or better on the track and on the thumb.
                .foregroundStyle(chosen ? Theme.primaryText : Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, compact ? 9 : 14)
                .padding(.vertical, 8)
                // A 44 pt tap target at every text size.
                .frame(maxWidth: fill ? .infinity : nil, minHeight: Theme.Spacing.minTarget)
                .contentShape(optionShape(fill: fill))
                .background {
                    if chosen {
                        optionShape(fill: fill)
                            .fill(Theme.elevatedHover)
                            .padding(Self.inset)
                            .matchedGeometryEffect(id: "thumb", in: thumbSpace)
                    }
                }
            }
            .buttonStyle(.plain)
            .id(option.value)
            .accessibilityLabel(option.label)
            .accessibilityAddTraits(chosen ? .isSelected : [])
        }
    }

    /// The option's and thumb's shape: a capsule in a row, a rounded rectangle in the column (the thumb is this, inset).
    private func optionShape(fill: Bool) -> AnyShape {
        fill ? AnyShape(RoundedRectangle(cornerRadius: Self.stackCorner, style: .continuous)) : AnyShape(Capsule())
    }
}
