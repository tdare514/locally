import SwiftUI

/// The Stats page's period control (#367): one glass pill showing the current period, tinted by the
/// cover's colour, that opens a glass pop-up of large rows. Choosing a row closes it.
struct StatsPeriodPill: View {
    let current: StatsPeriodKind
    let tint: Color
    @Binding var isPresented: Bool
    let onSelect: (StatsPeriodKind) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// A pop-up is its own hierarchy: it takes the page's text size, held at the largest non-accessibility size so the five rows fit the screen.
    @Environment(\.dynamicTypeSize) private var typeSize

    private var currentLabel: String {
        Copy.Stats.periodOptions.first { $0.kind == current }?.label ?? ""
    }

    var body: some View {
        Button {
            isPresented = true
        } label: {
            HStack(spacing: 8) {
                Text(currentLabel)
                    .contentTransition(.opacity)
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.bold))
                    .rotationEffect(.degrees(isPresented && !reduceMotion ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .font(Theme.ScaledFont.subheadline.weight(.semibold))
            .foregroundStyle(Color.white)
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .frame(minHeight: Theme.Stats.minTarget)
            .background {
                ZStack {
                    Capsule().fill(Theme.StatsPopup.base.opacity(0.55))
                    GlowGlass().clipShape(Capsule())
                    Capsule().fill(tint.opacity(Theme.StatsPopup.washOpacity))
                }
                .shadow(color: tint.opacity(0.35), radius: 10)
            }
            .overlay { GlowRim() }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : Theme.StatsPopup.ease, value: isPresented)
        .animation(reduceMotion ? nil : Theme.StatsPopup.ease, value: current)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Copy.Stats.periodPillLabel), \(currentLabel)")
        .accessibilityAddTraits(.isButton)
        .popover(isPresented: $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: .top) {
            StatsPeriodPopup(current: current, tint: tint) { kind in
                withAnimation(reduceMotion ? nil : Theme.StatsPopup.ease) { isPresented = false }
                onSelect(kind)
            }
            .dynamicTypeSize(min(typeSize, .xxxLarge))
            .presentationCompactAdaptation(.popover)
            .presentationBackground { StatsPopupBackground(tint: tint) }
        }
    }
}

/// The pop-up's faked glass: a dark base, the cover's colour as a wash, the Glow glass highlight.
struct StatsPopupBackground: View {
    let tint: Color

    var body: some View {
        ZStack {
            Theme.StatsPopup.base.opacity(Theme.StatsPopup.baseOpacity)
            LinearGradient(
                colors: [tint.opacity(Theme.StatsPopup.washOpacity + 0.1), tint.opacity(0.08)],
                startPoint: .top, endPoint: .bottom
            )
            GlowGlass()
        }
    }
}

/// The period rows: big targets, the chosen one lit with the cover's colour.
struct StatsPeriodPopup: View {
    let current: StatsPeriodKind
    let tint: Color
    let onSelect: (StatsPeriodKind) -> Void

    private var rows: some View {
        VStack(spacing: 6) {
            ForEach(Copy.Stats.periodOptions, id: \.kind) { option in
                StatsPeriodRow(label: option.label, chosen: option.kind == current, tint: tint) { onSelect(option.kind) }
            }
        }
        .padding(10)
        .frame(minWidth: Theme.StatsPopup.width)
    }

    var body: some View {
        rows
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Copy.Stats.periodPopupLabel)
        .sensoryFeedback(.selection, trigger: current)
    }
}

private struct StatsPeriodRow: View {
    let label: String
    let chosen: Bool
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text(label)
                    .font(.system(.body, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(chosen ? 1 : 0.8))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                if chosen {
                    Image(systemName: "checkmark")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(Color.white)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: Theme.StatsPopup.rowHeight, alignment: .leading)
            .background {
                if chosen {
                    Capsule()
                        .fill(Theme.StatsPopup.base.opacity(0.7))
                        .overlay(Capsule().fill(tint.opacity(Theme.StatsPopup.selectedWash)))
                        .overlay(Capsule().strokeBorder(Color.white.opacity(0.35), lineWidth: 1))
                        .shadow(color: tint.opacity(Theme.StatsPopup.glow), radius: 10)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}
