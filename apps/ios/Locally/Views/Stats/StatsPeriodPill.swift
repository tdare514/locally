import SwiftUI

/// The Stats page's period control (#367): one quiet `elevated` pill showing the current period (no tint,
/// glow or rim, #411) that opens a glass pop-up of large rows. Choosing a row closes it.
struct StatsPeriodPill: View {
    let current: StatsPeriodKind
    /// The period's name ("This week", "Last month") and its dates ("18 to 24 Oct"), shown together in the pill.
    let title: String
    let detail: String
    let tint: Color
    @Binding var isPresented: Bool
    let onSelect: (StatsPeriodKind) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// From the accessibility sizes up the choices open as a sheet, not the popover.
    @Environment(\.dynamicTypeSize) private var typeSize


    var body: some View {
        Button {
            isPresented = true
        } label: {
            HStack(spacing: 8) {
                VStack(spacing: 1) {
                    Text(title)
                        .font(Theme.ScaledFont.subheadline.weight(.semibold))
                        .contentTransition(.opacity)
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(Color.white.opacity(0.85))
                        .contentTransition(.opacity)
                }
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.bold))
                    .rotationEffect(.degrees(isPresented && !reduceMotion ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .frame(minHeight: Theme.Stats.minTarget)
            .background(Theme.elevated, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : Theme.StatsPopup.ease, value: isPresented)
        .animation(reduceMotion ? nil : Theme.StatsPopup.ease, value: title)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Copy.Stats.periodPillLabel), \(title), \(detail)")
        .accessibilityAddTraits(.isButton)
        .popover(isPresented: typeSize.isAccessibilitySize ? .constant(false) : $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: .top) {
            StatsPeriodPopup(current: current, tint: tint) { choose($0) }
                .presentationCompactAdaptation(.popover)
                .presentationBackground { StatsPopupBackground(tint: tint) }
        }
        .sheet(isPresented: typeSize.isAccessibilitySize ? $isPresented : .constant(false)) {
            StatsPeriodSheet(current: current, tint: tint, onClose: { isPresented = false }) { choose($0) }
                .dynamicTypeSize(typeSize)
                .presentationDetents([.medium, .large])
                .presentationBackground { StatsPopupBackground(tint: tint) }
        }
    }

    private func choose(_ kind: StatsPeriodKind) {
        withAnimation(reduceMotion ? nil : Theme.StatsPopup.ease) { isPresented = false }
        onSelect(kind)
    }
}

/// At accessibility text sizes the choices open as a sheet: the same large glass rows, scrollable.
struct StatsPeriodSheet: View {
    let current: StatsPeriodKind
    let tint: Color
    let onClose: () -> Void
    let onSelect: (StatsPeriodKind) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                ForEach(Copy.Stats.periodOptions, id: \.kind) { option in
                    StatsPeriodRow(label: option.label, chosen: option.kind == current, tint: tint) { onSelect(option.kind) }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 56)
            .padding(.bottom, 24)
        }
        .overlay(alignment: .topTrailing) {
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(.title3, weight: .bold))
                    .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                    .foregroundStyle(Color.red)
                    .frame(width: Theme.Stats.minTarget, height: Theme.Stats.minTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
            .padding(.top, 12)
            .padding(.trailing, 14)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Copy.Stats.periodPopupLabel)
        .sensoryFeedback(.selection, trigger: current)
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
