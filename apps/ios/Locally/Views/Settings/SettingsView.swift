import SwiftUI

/// Folder connection status (with reconnect) and the About section with
/// the required Spotify trademark line.
struct SettingsView: View {
    @Environment(\.appContainer) private var container
    @Environment(FolderStatus.self) private var folderStatus
    @Environment(PurchaseStatus.self) private var purchaseStatus

    @State private var isPresentingFolderPicker = false
    @State private var isPresentingPaywall = false
    @State private var errorMessage: String?

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Image(systemName: folderStatus.isConnected ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(folderStatus.isConnected ? Theme.accent : .yellow)
                        Text(folderStatus.isConnected ? Copy.Settings.folderConnected : Copy.Settings.folderNotConnected)
                            .font(Theme.Font.body)
                            .foregroundStyle(Theme.primaryText)
                    }

                    if !folderStatus.isConnected {
                        Text(Copy.Settings.folderLost)
                            .font(Theme.Font.rowSubtitle)
                            .foregroundStyle(Theme.secondaryText)
                    }

                    Button(Copy.Settings.reconnect) {
                        isPresentingFolderPicker = true
                    }
                    .buttonStyle(SecondaryPillButtonStyle())
                    .listRowSeparator(.hidden)

                    if let errorMessage {
                        Text(errorMessage)
                            .font(Theme.Font.rowSubtitle)
                            .foregroundStyle(Theme.danger)
                    }
                }
                .listRowBackground(Theme.card)

                Section {
                    if purchaseStatus.isFullUnlocked {
                        LabeledContent(Copy.Purchase.rowTitle, value: Copy.Purchase.unlocked)
                            .font(Theme.Font.body)
                            .foregroundStyle(Theme.primaryText)
                    } else {
                        Button {
                            isPresentingPaywall = true
                        } label: {
                            HStack {
                                Text(Copy.Purchase.rowTitle)
                                    .font(Theme.Font.body)
                                    .foregroundStyle(Theme.primaryText)
                                Spacer()
                                Text(Copy.Purchase.buy)
                                    .font(Theme.Font.body)
                                    .foregroundStyle(Theme.secondaryText)
                            }
                        }
                    }
                }
                .listRowBackground(Theme.card)

                Section {
                    AppIconPicker()
                        .listRowSeparator(.hidden)
                } header: {
                    Text(Copy.Settings.appIcon).eyebrow()
                }
                .listRowBackground(Theme.card)

                Section {
                    Text(Copy.Settings.trademarkLine)
                        .font(Theme.Font.rowSubtitle)
                        .foregroundStyle(Theme.secondaryText)
                    LabeledContent(Copy.Settings.version, value: appVersion)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.primaryText)
                } header: {
                    Text(Copy.Settings.about).eyebrow()
                }
                .listRowBackground(Theme.card)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(Copy.Settings.title)
        }
        .fileImporter(isPresented: $isPresentingFolderPicker, allowedContentTypes: [.folder]) { result in
            handleFolderPick(result)
        }
        .sheet(isPresented: $isPresentingPaywall) {
            PaywallView()
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
