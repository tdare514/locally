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
    /// How many waiting files the user last dismissed the toast for; it
    /// comes back only when the count changes (new songs arrived).
    @State private var dismissedCount: Int?
    @State private var singleQueue: [InboxFile] = []
    @State private var albumQueue: [InboxFile] = []

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                header
                    .padding(.horizontal, Theme.Spacing.pagePadding)
                    .padding(.top, 8)

                SegmentedPill(
                    options: [(Kind.single, Copy.Import.kindSingle), (Kind.album, Copy.Import.kindAlbum)],
                    selection: $kind
                )
                .padding(.horizontal, Theme.Spacing.pagePadding)
                .padding(.top, 16)

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
            // Waiting songs surface as a floating toast rather than a block in
            // the layout, so the form never shifts and the note reads as a
            // notification. Dismissed until the count changes.
            .overlay(alignment: .top) {
                if !inboxFiles.isEmpty, dismissedCount != inboxFiles.count {
                    inboxToast
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.spring(duration: 0.35), value: inboxFiles.count)
            .animation(.spring(duration: 0.35), value: dismissedCount)
            // The in-content eyebrow + title above already shows "Add a
            // song"; an empty nav title avoids repeating it in the system
            // bar while keeping that bar's black, minimal chrome.
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear { refreshInbox() }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active { refreshInbox() }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(Copy.Import.eyebrow).eyebrow()
            Text(Copy.Import.title)
                .font(Theme.Font.pageTitle)
                .foregroundStyle(Theme.primaryText)
        }
    }

    private var inboxToast: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(Copy.Inbox.waitingBanner(count: inboxFiles.count))
                    .font(Theme.Font.body.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
                HStack(spacing: 14) {
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
                .font(Theme.Font.rowSubtitle.weight(.medium))
                .foregroundStyle(Theme.accent)
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
            Button {
                dismissedCount = inboxFiles.count
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.secondaryText)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Copy.Inbox.dismiss)
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial)
        .background(Theme.card.opacity(0.85))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.45), radius: 18, y: 8)
        .padding(.horizontal, Theme.Spacing.pagePadding)
        .padding(.top, 6)
    }

    private func refreshInbox() {
        guard let container else { return }
        // Files already sent to Spotify are never "waiting", even when the
        // connected folder happens to be one the inbox also scans.
        let knownPaths = Set(((try? container.library.all()) ?? []).flatMap { $0.tracks.map(\.filePath) })
        inboxFiles = container.inbox.pendingFiles().filter { !knownPaths.contains($0.url.path) }
    }
}
