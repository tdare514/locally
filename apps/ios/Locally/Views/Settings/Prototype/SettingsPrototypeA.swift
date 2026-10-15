#if DEBUG
import SwiftUI

/// Direction A, "Glass groups" (#160): faked-glass cards on the studio backdrop, tinted icon
/// tiles, sentence-case titles, and the account as a hero card at the top. Static sample state.
struct SettingsPrototypeA: View {
    @State private var selectedIcon = "AppIcon"

    var body: some View {
        PrototypeScreen {
            VStack(alignment: .leading, spacing: 26) {
                Text(Copy.Settings.title)
                    .font(ProtoFont.largeTitle)
                    .padding(.horizontal, 6)
                    .accessibilityAddTraits(.isHeader)

                accountHero

                section(SettingsPrototypeCopy.folderSection, id: "folder") {
                    GlassCard {
                        GlassRow(symbol: "checkmark", tint: ProtoTint.blue, title: Copy.Settings.folderConnected)
                        GlassDivider()
                        Button {} label: {
                            GlassRow(symbol: "arrow.triangle.2.circlepath", tint: ProtoTint.slate,
                                     title: Copy.Settings.reconnect, chevron: true)
                        }
                        .buttonStyle(SoftPressStyle())
                    }
                }

                section(Copy.Sync.cardTitle, id: "sync") {
                    GlassCard {
                        GlassRow(symbol: "externaldrive.fill", tint: ProtoTint.teal, title: Copy.Sync.storageLabel,
                                 value: Copy.Sync.quota(usedMB: SettingsSample.usedMB, limitMB: SettingsSample.limitMB))
                        GlassDivider()
                        Button {} label: {
                            GlassRow(symbol: "trash.fill", tint: ProtoTint.danger,
                                     title: Copy.Sync.deleteAccountButton, destructive: true)
                        }
                        .buttonStyle(SoftPressStyle())
                    }
                    footnote(Copy.Sync.mergeNotice)
                }

                section(SettingsPrototypeCopy.purchaseSection, id: "purchase") {
                    GlassCard {
                        Button {} label: {
                            GlassRow(symbol: "sparkles", tint: ProtoTint.violet, title: Copy.Purchase.rowTitle, buyPill: Copy.Purchase.buy)
                        }
                        .buttonStyle(SoftPressStyle())
                    }
                }

                section(Copy.Settings.appIcon, id: "icon") {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 16) {
                            Text(Copy.Settings.appIconHint)
                                .font(ProtoFont.caption)
                                .foregroundStyle(Theme.secondaryText)
                            HStack(spacing: 22) {
                                ForEach(AppIconPicker.icons, id: \.self) { name in
                                    GlassIconChoice(name: name, isSelected: selectedIcon == name) {
                                        selectedIcon = name
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                        }
                        .padding(16)
                    }
                }

                section(Copy.Settings.about, id: "about") {
                    GlassCard {
                        Text(Copy.Settings.trademarkLine)
                            .font(ProtoFont.caption)
                            .foregroundStyle(Theme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(16)
                        GlassDivider()
                        GlassRow(symbol: "info", tint: ProtoTint.slate, title: Copy.Settings.version, value: SettingsSample.version)
                    }
                }
            }
            .padding(.horizontal, 20)
        }
    }

    // MARK: Hero

    private var accountHero: some View {
        GlassCard(prominent: true) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 14) {
                    Avatar(initial: SettingsSample.email.first.map { String($0).uppercased() } ?? "?")
                    VStack(alignment: .leading, spacing: 3) {
                        Text(SettingsSample.email)
                            .font(Font.system(.headline, weight: .semibold))
                            .foregroundStyle(Theme.primaryText)
                            .addressLineLimit()
                        Label(SettingsSample.device, systemImage: "iphone")
                            .font(Font.system(.subheadline))
                            .foregroundStyle(Theme.secondaryText)
                    }
                    Spacer(minLength: 0)
                }
                SyncPill(text: SettingsPrototypeCopy.syncedPill(SettingsSample.syncedAgo))
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { syncNow; signOut }
                    VStack(spacing: 10) { syncNow; signOut }
                }
            }
            .padding(18)
        }
    }

    private var syncNow: some View {
        Button {} label: { Text(Copy.Sync.syncNow) }
            .buttonStyle(HeroButtonStyle(isPrimary: true))
    }

    private var signOut: some View {
        Button {} label: { Text(Copy.Sync.signOut) }
            .buttonStyle(HeroButtonStyle(isPrimary: false))
    }

    // MARK: Pieces

    private func section<Content: View>(_ title: String, id: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(ProtoFont.sectionTitle)
                .foregroundStyle(Theme.secondaryText)
                .padding(.horizontal, 6)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .id(id)
    }

    private func footnote(_ text: String) -> some View {
        Text(text)
            .font(ProtoFont.caption)
            .foregroundStyle(Theme.textHint)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 6)
    }
}

// MARK: - Glass

/// The release page's faked glass (a faint white fill, a hairline stroke, no blur), with the
/// pieces that make it read as glass: a light cool tint, a soft inner glow from the top edge and
/// an edge highlight that fades down the sides. All gradients; nothing samples the backdrop.
private struct GlassSurface: View {
    var prominent: Bool
    private let radius: CGFloat = 26

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        shape
            .fill(Theme.Immersive.panelFill)
            .overlay(
                shape.fill(LinearGradient(
                    colors: [ProtoTint.slate.opacity(prominent ? 0.14 : 0.08), ProtoTint.slate.opacity(0.02)],
                    startPoint: .top, endPoint: .bottom
                ))
            )
            .overlay(
                shape.fill(RadialGradient(
                    colors: [.white.opacity(prominent ? 0.13 : 0.08), .clear],
                    center: UnitPoint(x: 0.3, y: 0), startRadius: 0, endRadius: 260
                ))
            )
            .overlay(
                shape.strokeBorder(
                    LinearGradient(
                        colors: [.white.opacity(0.26), .white.opacity(0.07), .white.opacity(0.02)],
                        startPoint: .top, endPoint: .bottom
                    ),
                    lineWidth: 1
                )
            )
    }
}

private struct GlassCard<Content: View>: View {
    var prominent = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .background(GlassSurface(prominent: prominent))
    }
}

private struct GlassDivider: View {
    var body: some View {
        FadingHairline(peak: 0.10).padding(.horizontal, 16)
    }
}

private struct GlassRow: View {
    let symbol: String
    let tint: Color
    let title: String
    var value: String?
    var chevron = false
    var destructive = false
    var buyPill: String?

    var body: some View {
        HStack(spacing: 14) {
            IconTile(symbol: symbol, tint: tint)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    titleText
                    Spacer(minLength: 8)
                    trailing
                }
                VStack(alignment: .leading, spacing: 4) {
                    titleText
                    trailing
                }
            }
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .frame(minHeight: 56)
        .contentShape(Rectangle())
    }

    private var titleText: some View {
        Text(title)
            .font(ProtoFont.rowTitle)
            .foregroundStyle(destructive ? Theme.danger : Theme.primaryText)
            .multilineTextAlignment(.leading)
    }

    @ViewBuilder
    private var trailing: some View {
        if let value {
            Text(value)
                .font(ProtoFont.value)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.trailing)
        } else if let buyPill {
            Text(buyPill)
                .font(ProtoFont.pill)
                .foregroundStyle(ProtoTint.accentText)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(Capsule().fill(Theme.accent.opacity(0.18)))
        }
    }
}

private struct Avatar: View {
    let initial: String
    @ScaledMetric(relativeTo: .title) private var side: CGFloat = 54

    var body: some View {
        Circle()
            .fill(LinearGradient(
                colors: [Theme.accent, Color(red: 0.50, green: 0.36, blue: 0.95)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ))
            .frame(width: side, height: side)
            .overlay(
                Text(initial)
                    .font(.system(size: side * 0.42, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            )
            .accessibilityHidden(true)
    }
}

private struct HeroButtonStyle: ButtonStyle {
    let isPrimary: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Font.system(.subheadline, weight: .semibold))
            .foregroundStyle(isPrimary ? Color.black : Theme.primaryText)
            .frame(maxWidth: .infinity, minHeight: 42)
            .padding(.horizontal, 16)
            .background(Capsule().fill(isPrimary ? Theme.accent : Color.white.opacity(0.09)))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// An app icon choice: the icon in a continuous rounded square, a soft accent halo and a small
/// check when picked. No ring, so no line.
private struct GlassIconChoice: View {
    let name: String
    let isSelected: Bool
    let action: () -> Void
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 64

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image("IconPreview-\(name)")
                    .resizable()
                    .frame(width: side, height: side)
                    .clipShape(RoundedRectangle(cornerRadius: side * 0.225, style: .continuous))
                    .shadow(color: isSelected ? Theme.accent.opacity(0.55) : .black.opacity(0.35),
                            radius: isSelected ? 12 : 6, y: isSelected ? 0 : 3)
                    .overlay(alignment: .bottomTrailing) {
                        if isSelected {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: side * 0.30))
                                .foregroundStyle(.white, Theme.accent)
                                .offset(x: 6, y: 6)
                        }
                    }
                Text(Copy.Settings.iconNames[name] ?? name)
                    .font(ProtoFont.caption)
                    .foregroundStyle(isSelected ? Theme.primaryText : Theme.secondaryText)
            }
            .padding(.bottom, 4)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Copy.Settings.iconNames[name] ?? name)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

#Preview("Settings A, Glass groups") {
    SettingsPrototypeA()
}
#endif
