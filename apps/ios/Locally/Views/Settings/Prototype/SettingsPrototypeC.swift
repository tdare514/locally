#if DEBUG
import SwiftUI

/// Direction C, "Quiet list" (#160): no cards and no icons. Large sentence-case headings, tall
/// rows with their values right-aligned in muted text, one soft divider between sections, a very
/// subtle studio backdrop, and the account as a simple header line. Static sample state.
struct SettingsPrototypeC: View {
    var body: some View {
        PrototypeScreen(backdropIntensity: 0.5) {
            VStack(alignment: .leading, spacing: 0) {
                header

                section(SettingsPrototypeCopy.folderSection, id: "folder") {
                    QuietRow(title: Copy.Settings.folderConnected, action: Copy.Settings.reconnect)
                }

                section(Copy.Sync.cardTitle, id: "sync") {
                    QuietRow(title: Copy.Sync.storageLabel,
                             value: Copy.Sync.quota(usedMB: SettingsSample.usedMB, limitMB: SettingsSample.limitMB))
                    QuietRow(title: Copy.Sync.lastSynced(SettingsSample.syncedAgo), muted: true)
                    QuietRow(title: Copy.Sync.syncNow, tone: .accent)
                    QuietRow(title: Copy.Sync.signOut)
                    QuietRow(title: Copy.Sync.deleteAccountButton, tone: .danger)
                    Text(Copy.Sync.mergeNotice)
                        .font(ProtoFont.caption)
                        .foregroundStyle(Theme.textHint)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 6)
                }

                section(SettingsPrototypeCopy.purchaseSection, id: "purchase") {
                    QuietRow(title: Copy.Purchase.rowTitle, value: Copy.Purchase.buy, valueTone: .accent)
                }

                section(Copy.Settings.appIcon, id: "icon") {
                    Text(Copy.Settings.appIconHint)
                        .font(ProtoFont.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .padding(.bottom, 14)
                    QuietIconChoices()
                }

                section(Copy.Settings.about, id: "about") {
                    Text(Copy.Settings.trademarkLine)
                        .font(ProtoFont.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 8)
                    QuietRow(title: Copy.Settings.version, value: SettingsSample.version)
                }
            }
            .padding(.horizontal, 24)
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(Copy.Settings.title)
                .font(ProtoFont.largeTitle)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 2) {
                Text(SettingsSample.email)
                    .font(Font.system(.callout, weight: .medium))
                    .foregroundStyle(Theme.primaryText)
                    .addressLineLimit()
                Text("\(SettingsSample.device) · \(SettingsPrototypeCopy.syncedPill(SettingsSample.syncedAgo))")
                    .font(Font.system(.callout))
                    .foregroundStyle(Theme.secondaryText)
            }
            .accessibilityElement(children: .combine)
        }
        .padding(.bottom, 8)
    }

    private func section<Content: View>(
        _ title: String, id: String, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            FadingHairline(peak: 0.12)
                .padding(.top, 30)
                .padding(.bottom, 26)
            Text(title)
                .font(ProtoFont.heading)
                .foregroundStyle(Theme.primaryText)
                .padding(.bottom, 8)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .id(id)
    }
}

// MARK: - Rows

private struct QuietRow: View {
    enum Tone { case normal, accent, danger }

    let title: String
    var value: String?
    var action: String?
    var tone: Tone = .normal
    var valueTone: Tone = .normal
    var muted = false

    var body: some View {
        Button {} label: {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    titleText
                    Spacer(minLength: 8)
                    trailing
                }
                VStack(alignment: .leading, spacing: 4) {
                    titleText
                    trailing
                }
            }
            .frame(minHeight: muted ? 44 : 60)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var titleText: some View {
        Text(title)
            .font(ProtoFont.rowTitle)
            .foregroundStyle(muted ? Theme.secondaryText : color(tone, base: Theme.primaryText))
            .multilineTextAlignment(.leading)
    }

    @ViewBuilder
    private var trailing: some View {
        if let value {
            Text(value)
                .font(ProtoFont.value)
                .foregroundStyle(color(valueTone, base: Theme.secondaryText))
                .multilineTextAlignment(.trailing)
        } else if let action {
            Text(action)
                .font(Font.system(.body, weight: .medium))
                .foregroundStyle(Theme.accent)
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

/// The two app icons side by side, the picked one fully lit and the other dimmed. No ring.
private struct QuietIconChoices: View {
    @State private var selected = "AppIcon"
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 60

    var body: some View {
        HStack(spacing: 24) {
            ForEach(AppIconPicker.icons, id: \.self) { name in
                Button { selected = name } label: {
                    VStack(spacing: 8) {
                        Image("IconPreview-\(name)")
                            .resizable()
                            .frame(width: side, height: side)
                            .clipShape(RoundedRectangle(cornerRadius: side * 0.225, style: .continuous))
                            .opacity(selected == name ? 1 : 0.62)
                        Text(Copy.Settings.iconNames[name] ?? name)
                            .font(ProtoFont.caption)
                            .foregroundStyle(selected == name ? Theme.primaryText : Theme.secondaryText)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Copy.Settings.iconNames[name] ?? name)
                .accessibilityAddTraits(selected == name ? .isSelected : [])
            }
            Spacer(minLength: 0)
        }
        .animation(.easeOut(duration: 0.2), value: selected)
        .padding(.bottom, 4)
    }
}

#Preview("Settings C, Quiet list") {
    SettingsPrototypeC()
}
#endif
