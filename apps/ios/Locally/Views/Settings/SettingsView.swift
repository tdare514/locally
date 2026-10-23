import SwiftUI

/// Settings (#160, direction A "Glass groups"): the account card, then the Spotify folder with
/// Reconnect, the sync group, the purchase, the app icon and About with the required Spotify
/// trademark line, each in a faked-glass card on the studio backdrop. The title is part of the
/// page (no navigation bar), and the content fades out at the top and bottom of the screen instead
/// of being cut off by it.
struct SettingsView: View {
    @Environment(\.appContainer) private var container
    @Environment(FolderStatus.self) private var folderStatus
    @Environment(PurchaseStatus.self) private var purchaseStatus

    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @AppStorage(BackdropMotion.keepMovingKey) private var keepBackdropsMoving = false

    @State private var isPresentingFolderPicker = false
    @State private var isPresentingPaywall = false
    @State private var errorMessage: String?

    private static var edgeFade: CGFloat { 22 }
    /// The bottom fade follows the safe area (home indicator, tab bar), but never more than this,
    /// so the keyboard's inset can't stretch it over the sign-in form.
    private static var maxBottomFade: CGFloat { 90 }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                StudioBackdrop()
                ScrollView {
                    VStack(alignment: .leading, spacing: 26) {
                        Text(Copy.Settings.title)
                            .font(Theme.ScaledFont.largeTitle)
                            .foregroundStyle(Theme.primaryText)
                            .padding(.horizontal, 6)
                            .accessibilityAddTraits(.isHeader)

                        SettingsHeroCard()

                        GlassSection(title: Copy.Settings.folderSection) { folderCard }

                        SyncSettingsSection()

                        SharedByYouSection()

                        GlassSection(title: Copy.Settings.purchaseSection) { purchaseCard }

                        GlassSection(title: Copy.Settings.appIcon) {
                            GlassCard { AppIconPicker().padding(16) }
                        }

                        GlassSection(
                            title: Copy.Settings.motionSection,
                            footnote: !systemReduceMotion
                                ? Copy.Settings.keepBackdropsMovingHint
                                : keepBackdropsMoving
                                    ? Copy.Settings.keepBackdropsMovingHintKept
                                    : Copy.Settings.keepBackdropsMovingHintReduced
                        ) {
                            GlassCard {
                                GlassToggleRow(
                                    symbol: "wind", tint: Theme.Tint.slate,
                                    title: Copy.Settings.keepBackdropsMoving, isOn: $keepBackdropsMoving
                                )
                            }
                        }

                        GlassSection(title: Copy.Settings.about) { aboutCard }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, Self.edgeFade)
                    .padding(.bottom, Self.edgeFade + 40)
                    .frame(maxWidth: .infinity)
                }
                .scrollIndicators(.hidden)
                .mask(edgeMask(bottom: min(max(Self.edgeFade, geo.safeAreaInsets.bottom), Self.maxBottomFade)))
            }
        }
        // The tab bar sits straight on the backdrop (no black block, no line); the fade above keeps
        // the content from running under its icons. The other tabs keep `Theme.applyChrome()`.
        .toolbarBackground(.hidden, for: .tabBar)
        .fileImporter(isPresented: $isPresentingFolderPicker, allowedContentTypes: [.folder]) { result in
            handleFolderPick(result)
        }
        .sheet(isPresented: $isPresentingPaywall) {
            PaywallView()
        }
    }

    // MARK: Cards

    private var folderCard: some View {
        GlassCard {
            if folderStatus.isConnected {
                GlassRow(symbol: "checkmark", tint: Theme.accent, title: Copy.Settings.folderConnected)
            } else {
                GlassRow(symbol: "exclamationmark.triangle.fill", tint: .yellow, title: Copy.Settings.folderNotConnected)
                Text(Copy.Settings.folderLost)
                    .font(Theme.ScaledFont.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
            }
            GlassDivider()
            Button {
                isPresentingFolderPicker = true
            } label: {
                GlassRow(symbol: "arrow.triangle.2.circlepath", tint: Theme.Tint.slate, title: Copy.Settings.reconnect, chevron: true)
            }
            .buttonStyle(SoftPressStyle())

            if let errorMessage {
                Text(errorMessage)
                    .font(Theme.ScaledFont.caption)
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
            }
        }
    }

    private var purchaseCard: some View {
        GlassCard {
            if purchaseStatus.isFullUnlocked {
                GlassRow(symbol: "sparkles", tint: Theme.Tint.violet, title: Copy.Purchase.rowTitle, value: Copy.Purchase.unlocked)
            } else {
                Button {
                    isPresentingPaywall = true
                } label: {
                    GlassRow(symbol: "sparkles", tint: Theme.Tint.violet, title: Copy.Purchase.rowTitle, pill: Copy.Purchase.buy)
                }
                .buttonStyle(SoftPressStyle())
            }
        }
    }

    private var aboutCard: some View {
        GlassCard {
            Text(Copy.Settings.trademarkLine)
                .font(Theme.ScaledFont.caption)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(16)
            GlassDivider()
            GlassRow(symbol: "info", tint: Theme.Tint.slate, title: Copy.Settings.version, value: appVersion)
        }
    }

    /// Content reaches full strength `edgeFade` points inside the top of the screen and `bottom`
    /// points above its foot (at least the home indicator, and the tab bar when it is the screen's
    /// foot), so nothing meets the status bar or the tab bar in a line.
    private func edgeMask(bottom: CGFloat) -> some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                .frame(height: Self.edgeFade)
            Rectangle().fill(.black)
            LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: bottom)
        }
    }

    private func handleFolderPick(_ result: Result<URL, Error>) {
        guard let container else { return }
        switch result {
        case .success(let url):
            do {
                try container.connectFolder(url: url)
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        case .failure(let error):
            errorMessage = error.localizedDescription
        }
    }
}
