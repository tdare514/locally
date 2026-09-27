import SwiftUI

/// Folder connection status (with reconnect) and the About section with
/// the required Spotify trademark line.
struct SettingsView: View {
    @Environment(\.appContainer) private var container
    @Environment(FolderStatus.self) private var folderStatus

    @State private var isPresentingFolderPicker = false
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
                            .foregroundStyle(Theme.primaryText)
                    }

                    if !folderStatus.isConnected {
                        Text(Copy.Settings.folderLost)
                            .font(.footnote)
                            .foregroundStyle(Theme.secondaryText)
                    }

                    Button(Copy.Settings.reconnect) {
                        isPresentingFolderPicker = true
                    }
                    .foregroundStyle(Theme.accent)

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
                .listRowBackground(Theme.panel)

                Section(Copy.Settings.about) {
                    Text(Copy.Settings.trademarkLine)
                        .font(.footnote)
                        .foregroundStyle(Theme.secondaryText)
                    LabeledContent(Copy.Settings.version, value: appVersion)
                        .foregroundStyle(Theme.primaryText)
                }
                .listRowBackground(Theme.panel)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(Copy.Settings.title)
        }
        .fileImporter(isPresented: $isPresentingFolderPicker, allowedContentTypes: [.folder]) { result in
            handleFolderPick(result)
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
