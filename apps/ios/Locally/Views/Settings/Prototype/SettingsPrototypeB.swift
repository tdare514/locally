#if DEBUG
import SwiftUI

/// Direction B, "Record shelf" (#160): the app icon on a small record sleeve with the disc
/// peeking out heads the page, then plain rows on the studio backdrop split by hairlines that
/// fade at both ends. Accent toggles; the App icon picker shows the icons as sleeves. Static
/// sample state.
struct SettingsPrototypeB: View {
    @State private var selectedIcon = "AppIcon"
    @State private var mobileData = true

    var body: some View {
        PrototypeScreen {
            VStack(alignment: .leading, spacing: 30) {
                Text(Copy.Settings.title)
                    .font(ProtoFont.largeTitle)
                    .accessibilityAddTraits(.isHeader)

                hero

                shelf(SettingsPrototypeCopy.folderSection, id: "folder") {
                    ShelfRow(title: Copy.Settings.folderConnected, leading: .check)
                    ShelfDivider()
                    Button {} label: { ShelfRow(title: Copy.Settings.reconnect, tone: .accent, chevron: true) }
                        .buttonStyle(SoftPressStyle())
                }

                shelf(Copy.Sync.cardTitle, id: "sync") {
                    ShelfRow(title: Copy.Sync.storageLabel,
                             value: Copy.Sync.quota(usedMB: SettingsSample.usedMB, limitMB: SettingsSample.limitMB))
                    ShelfDivider()
                    // Placeholder: Settings has no toggle today. It is here to show the accent switch.
                    Toggle(SettingsSample.mobileDataPlaceholder, isOn: $mobileData)
                        .toggleStyle(AccentToggleStyle())
                        .font(ProtoFont.rowTitle)
                        .foregroundStyle(Theme.primaryText)
                        .padding(.vertical, 8)
                        .frame(minHeight: 52)
                    ShelfDivider()
                    Button {} label: { ShelfRow(title: Copy.Sync.syncNow, tone: .accent, chevron: true) }
                        .buttonStyle(SoftPressStyle())
                    ShelfDivider()
                    Button {} label: { ShelfRow(title: Copy.Sync.signOut) }
                        .buttonStyle(SoftPressStyle())
                    ShelfDivider()
                    Button {} label: { ShelfRow(title: Copy.Sync.deleteAccountButton, tone: .danger) }
                        .buttonStyle(SoftPressStyle())
                    Text(Copy.Sync.mergeNotice)
                        .font(ProtoFont.caption)
                        .foregroundStyle(Theme.textHint)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                }

                shelf(SettingsPrototypeCopy.purchaseSection, id: "purchase") {
                    Button {} label: { ShelfRow(title: Copy.Purchase.rowTitle, value: Copy.Purchase.buy, valueTone: .accent, chevron: true) }
                        .buttonStyle(SoftPressStyle())
                }

                shelf(Copy.Settings.appIcon, id: "icon") {
                    Text(Copy.Settings.appIconHint)
                        .font(ProtoFont.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .padding(.bottom, 14)
                    HStack(alignment: .top, spacing: 28) {
                        ForEach(AppIconPicker.icons, id: \.self) { name in
                            SleeveChoice(name: name, isSelected: selectedIcon == name) { selectedIcon = name }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.bottom, 6)
                }

                shelf(Copy.Settings.about, id: "about") {
                    Text(Copy.Settings.trademarkLine)
                        .font(ProtoFont.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 8)
                    ShelfDivider()
                    ShelfRow(title: Copy.Settings.version, value: SettingsSample.version)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    // MARK: Hero

    private var hero: some View {
        VStack(spacing: 22) {
            MiniSleeve(iconName: "AppIcon", sleeve: 112, peek: 0.50, animatesIn: true)
            VStack(spacing: 4) {
                Text(SettingsSample.email)
                    .font(Font.system(.headline, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
                    .addressLineLimit()
                Text("\(SettingsSample.device) · \(SettingsPrototypeCopy.syncedPill(SettingsSample.syncedAgo))")
                    .font(Font.system(.subheadline))
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 6)
        .accessibilityElement(children: .combine)
    }

    // MARK: Pieces

    private func shelf<Content: View>(_ title: String, id: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(ProtoFont.sectionTitle)
                .foregroundStyle(Theme.secondaryText)
                .padding(.bottom, 6)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .id(id)
    }
}

// MARK: - Rows

private struct ShelfDivider: View {
    var body: some View { FadingHairline() }
}

private struct ShelfRow: View {
    enum Tone { case normal, accent, danger }
    enum Leading { case none, check }

    let title: String
    var value: String?
    var tone: Tone = .normal
    var valueTone: Tone = .normal
    var leading: Leading = .none
    var chevron = false

    var body: some View {
        HStack(spacing: 12) {
            if leading == .check {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(.body, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .accessibilityHidden(true)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    titleText
                    Spacer(minLength: 8)
                    valueText
                }
                VStack(alignment: .leading, spacing: 4) {
                    titleText
                    valueText
                }
            }
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.vertical, 8)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
    }

    private var titleText: some View {
        Text(title)
            .font(ProtoFont.rowTitle)
            .foregroundStyle(color(tone, base: Theme.primaryText))
            .multilineTextAlignment(.leading)
    }

    @ViewBuilder
    private var valueText: some View {
        if let value {
            Text(value)
                .font(ProtoFont.value)
                .foregroundStyle(color(valueTone, base: Theme.secondaryText))
                .multilineTextAlignment(.trailing)
        }
    }

    private func color(_ tone: Tone, base: Color) -> Color {
        switch tone {
        case .normal: base
        case .accent: Theme.accent
        case .danger: Theme.danger
        }
    }
}

// MARK: - Sleeves

/// A small record sleeve with the disc peeking out to the right: the sleeve and disc are the
/// release page's, scaled down. The disc slides out once when the page opens (not under Reduce
/// Motion). Grooves are drawn once.
private struct MiniSleeve: View {
    let iconName: String
    let sleeve: CGFloat
    /// How much of the disc shows past the sleeve, as a share of the disc diameter.
    let peek: CGFloat
    var animatesIn = false
    var isLifted = false

    @State private var isOut: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(iconName: String, sleeve: CGFloat, peek: CGFloat, animatesIn: Bool = false, isLifted: Bool = false) {
        self.iconName = iconName
        self.sleeve = sleeve
        self.peek = peek
        self.animatesIn = animatesIn
        self.isLifted = isLifted
        _isOut = State(initialValue: !animatesIn)
    }

    var body: some View {
        let disc = sleeve * Theme.Immersive.discToSleeveRatio
        let shown = disc * peek
        let radius = max(2, sleeve * 0.03)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        ZStack(alignment: .leading) {
            MiniDisc(size: disc)
                .offset(x: sleeve + (isOut ? shown : 0) - disc)
            Image("IconPreview-\(iconName)")
                .resizable()
                .scaledToFill()
                .frame(width: sleeve, height: sleeve)
                .clipShape(shape)
                .overlay(
                    // The release page's sheen, a touch stronger: these sleeves hold a black icon on a dark page.
                    shape.fill(LinearGradient(
                        stops: [
                            .init(color: .white.opacity(0.16), location: 0),
                            .init(color: .white.opacity(0.04), location: 0.5),
                            .init(color: .clear, location: 0.8),
                        ],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    ))
                )
                .shadow(color: .black.opacity(0.55), radius: sleeve * 0.14, y: sleeve * 0.10)
                .shadow(color: .black.opacity(0.35), radius: sleeve * 0.04, y: sleeve * 0.03)
        }
        .frame(width: sleeve + shown, height: sleeve, alignment: .leading)
        .offset(y: isLifted ? -4 : 0)
        .accessibilityHidden(true)
        .onAppear {
            guard animatesIn, !isOut else { return }
            if reduceMotion {
                isOut = true
            } else {
                withAnimation(.spring(duration: 0.9, bounce: 0.22).delay(0.25)) { isOut = true }
            }
        }
    }
}

/// The vinyl: dark face, faint grooves, an accent label with a spindle hole, one fixed sheen.
private struct MiniDisc: View {
    let size: CGFloat

    var body: some View {
        let label = size * Theme.Immersive.labelToDiscRatio
        ZStack {
            Circle().fill(Theme.Immersive.discColor)
            Canvas { context, canvas in
                let outer = min(canvas.width, canvas.height) / 2
                var radius = label / 2 + 2
                while radius < outer - 1 {
                    let rect = CGRect(x: canvas.width / 2 - radius, y: canvas.height / 2 - radius, width: radius * 2, height: radius * 2)
                    context.stroke(Path(ellipseIn: rect), with: .color(.white.opacity(Theme.Immersive.grooveOpacity)), lineWidth: 0.5)
                    radius += 2.2
                }
            }
            Circle()
                .fill(AngularGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .clear, location: 0.08),
                        .init(color: .white.opacity(Theme.Immersive.sheenOpacityNear), location: 0.13),
                        .init(color: .clear, location: 0.20),
                        .init(color: .clear, location: 0.52),
                        .init(color: .white.opacity(Theme.Immersive.sheenOpacityFar), location: 0.62),
                        .init(color: .clear, location: 0.70),
                        .init(color: .clear, location: 1),
                    ],
                    center: .center,
                    angle: .degrees(Theme.Immersive.sheenStartDegrees - 90)
                ))
            Circle()
                .fill(Theme.accent)
                .frame(width: label, height: label)
                .overlay(
                    Circle()
                        .fill(Theme.background)
                        .frame(width: label * Theme.Immersive.spindleToLabelRatio * 1.6, height: label * Theme.Immersive.spindleToLabelRatio * 1.6)
                )
        }
        .frame(width: size, height: size)
        .shadow(color: .black.opacity(0.5), radius: size * 0.08, y: size * 0.07)
    }
}

/// An app icon as a small sleeve: the picked one lifts and gains a soft accent glow, the other
/// stays quiet. No ring.
private struct SleeveChoice: View {
    let name: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                MiniSleeve(iconName: name, sleeve: 64, peek: 0.34, isLifted: isSelected)
                    .opacity(isSelected ? 1 : 0.8)
                    .background(alignment: .bottom) {
                        if isSelected {
                            Ellipse()
                                .fill(RadialGradient(
                                    colors: [Theme.accent.opacity(0.5), .clear],
                                    center: .center, startRadius: 0, endRadius: 46
                                ))
                                .frame(width: 96, height: 36)
                                .offset(y: 22)
                        }
                    }
                Text(Copy.Settings.iconNames[name] ?? name)
                    .font(ProtoFont.caption)
                    .foregroundStyle(isSelected ? Theme.primaryText : Theme.secondaryText)
            }
            .padding(.bottom, 12)
            .animation(.easeOut(duration: 0.2), value: isSelected)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Copy.Settings.iconNames[name] ?? name)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

#Preview("Settings B, Record shelf") {
    SettingsPrototypeB()
}
#endif
