import SwiftUI

/// The Import tab's root: a segmented control switches between the
/// single-track flow (`ImportSingleView`, phase 1) and the album builder
/// (`AlbumBuilderView`, phase 2). Owns the one `NavigationStack` for both —
/// each child view supplies only its own content, never its own stack or
/// `.fileImporter` conflicting with the other's, since only one is in the
/// tree at a time.
struct ImportView: View {
    private enum Kind: Hashable {
        case single, album
    }

    @Environment(\.appContainer) private var container
    @Environment(\.scenePhase) private var scenePhase

    @State private var kind: Kind = .single
    /// Files currently waiting in the share inbox, shown as a banner above
    /// the segmented control. Checked on appear and whenever the app comes
    /// back to the foreground, since the share extension can only add to
    /// the inbox while this app isn't running.
    @State private var inboxFiles: [InboxFile] = []
    @State private var singleQueue: [InboxFile] = []
    @State private var albumQueue: [InboxFile] = []

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !inboxFiles.isEmpty {
                    inboxBanner
                }

                Picker("", selection: $kind) {
                    Text(Copy.Import.kindSingle).tag(Kind.single)
                    Text(Copy.Import.kindAlbum).tag(Kind.album)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)
                .padding(.top, 12)

                Group {
                    switch kind {
                    case .single:
                        ImportSingleView(inboxQueue: singleQueue) { singleQueue = [] }
                    case .album:
                        AlbumBuilderView(inboxFiles: albumQueue) { albumQueue = [] }
                    }
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Copy.Import.title)
        }
        .onAppear { refreshInbox() }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active { refreshInbox() }
        }
    }

    private var inboxBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(Copy.Inbox.waitingBanner(count: inboxFiles.count))
                .font(.footnote)
                .foregroundStyle(Theme.primaryText)

            HStack(spacing: 16) {
                Button(Copy.Inbox.addAsSingles) {
                    singleQueue = inboxFiles
                    inboxFiles = []
                    kind = .single
                }
                Button(Copy.Inbox.makeAnAlbum) {
                    albumQueue = inboxFiles
                    inboxFiles = []
                    kind = .album
                }
            }
            .font(.subheadline)
            .foregroundStyle(Theme.accent)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private func refreshInbox() {
        guard let container else { return }
        inboxFiles = container.inbox.pendingFiles()
    }
}
