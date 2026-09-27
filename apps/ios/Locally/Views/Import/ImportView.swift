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
    @Environment(SyncStatus.self) private var syncStatus

    @State private var kind: Kind = .single
    /// Files currently waiting in the share inbox, shown as a banner above
    /// the segmented control. Checked on appear and whenever the app comes
    /// back to the foreground, since the share extension can only add to
    /// the inbox while this app isn't running.
    @State private var inboxFiles: [InboxFile] = []
    /// How many waiting files the user last dismissed the toast for; it
    /// comes back only when the count changes (new songs arrived).
    @State private var dismissedCount: Int?
    /// The toast shows for a few seconds when songs arrive, then tucks into
    /// the "N waiting" chip in the header; tapping the chip brings it back.
    @State private var toastVisible = false
    @State private var hideTask: Task<Void, Never>?
    @State private var singleQueue: [InboxFile] = []
    @State private var albumQueue: [InboxFile] = []
    /// Mirrors `toastVisible`/`dismissedCount` for the sync source: songs
    /// waiting on the Mac, offered separately from the share inbox above.
    @State private var syncToastVisible = false
    @State private var syncDismissedCount: Int?
    @State private var syncHideTask: Task<Void, Never>?

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
                .padding(.top, 24)

                Group {
                    switch kind {
                    case .single:
                        ImportSingleView(inboxQueue: singleQueue) { singleQueue = [] }
                    case .album:
                        AlbumBuilderView(inboxFiles: albumQueue) { albumQueue = [] }
                    }
                }
                .padding(.top, 24)
            }
            .background(Theme.background.ignoresSafeArea())
            // Waiting songs surface as a floating toast rather than a block in
            // the layout, so the form never shifts and the note reads as a
            // notification. Dismissed until the count changes.
            .overlay(alignment: .top) {
                VStack(spacing: 8) {
                    if !inboxFiles.isEmpty, toastVisible {
                        inboxToast
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                    if !syncStatus.pendingFromMac.isEmpty, syncToastVisible {
                        syncToast
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
            }
            .animation(.spring(duration: 0.35), value: toastVisible)
            .animation(.spring(duration: 0.35), value: syncToastVisible)
            .onChange(of: syncStatus.pendingFromMac.count) { _, count in
                if count > 0, syncDismissedCount != count { showSyncToast() } else { syncToastVisible = false }
            }
            .onChange(of: inboxFiles.count) { _, count in
                if count > 0, dismissedCount != count { showToast() } else { toastVisible = false }
            }
            // The in-content eyebrow + title above already shows "Add a
            // song"; an empty nav title avoids repeating it in the system
            // bar while keeping that bar's black, minimal chrome.
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            refreshInbox()
            if !inboxFiles.isEmpty, dismissedCount != inboxFiles.count { showToast() }
            if !syncStatus.pendingFromMac.isEmpty, syncDismissedCount != syncStatus.pendingFromMac.count { showSyncToast() }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active { refreshInbox() }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Text(Copy.Import.eyebrow).eyebrow()
                if !inboxFiles.isEmpty, !toastVisible {
                    Button {
                        showToast(autoHide: false)
                    } label: {
                        Text(Copy.Inbox.waitingChip(count: inboxFiles.count))
                            .font(Theme.Font.badge)
                            .foregroundStyle(.black)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Theme.accent, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .transition(.scale.combined(with: .opacity))
                }
                if !syncStatus.pendingFromMac.isEmpty, !syncToastVisible {
                    Button {
                        showSyncToast(autoHide: false)
                    } label: {
                        Text(Copy.Sync.pendingFromMac(count: syncStatus.pendingFromMac.count))
                            .font(Theme.Font.badge)
                            .foregroundStyle(.black)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Theme.accent, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .transition(.scale.combined(with: .opacity))
                }
            }
            Text(Copy.Import.title)
                .font(Theme.Font.pageTitle)
                .foregroundStyle(Theme.primaryText)
            Text(Copy.Import.subtitle)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.secondaryText)
        }
        .animation(.spring(duration: 0.3), value: toastVisible)
        .animation(.spring(duration: 0.3), value: syncToastVisible)
    }

    private func showToast(autoHide: Bool = true) {
        hideTask?.cancel()
        toastVisible = true
        guard autoHide else { return }
        hideTask = Task {
            try? await Task.sleep(for: .seconds(6))
            if !Task.isCancelled { toastVisible = false }
        }
    }

    private func showSyncToast(autoHide: Bool = true) {
        syncHideTask?.cancel()
        syncToastVisible = true
        guard autoHide else { return }
        syncHideTask = Task {
            try? await Task.sleep(for: .seconds(6))
            if !Task.isCancelled { syncToastVisible = false }
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
                toastVisible = false
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

    /// The Mac source's own toast, listing each pending release with its own
    /// "Send to Spotify" action (a spinner while `SyncStatus.acceptingIds`
    /// includes it) plus "Send all" when there's more than one.
    private var syncToast: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Text(Copy.Sync.pendingFromMac(count: syncStatus.pendingFromMac.count))
                    .font(Theme.Font.body.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
                Spacer(minLength: 0)
                if syncStatus.pendingFromMac.count > 1 {
                    Button(Copy.Sync.sendAll) {
                        Task { await container?.syncEngine.acceptAllFromMac() }
                    }
                    .font(Theme.Font.rowSubtitle.weight(.medium))
                    .foregroundStyle(Theme.accent)
                    .buttonStyle(.plain)
                }
                Button {
                    syncDismissedCount = syncStatus.pendingFromMac.count
                    syncToastVisible = false
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

            VStack(spacing: 6) {
                ForEach(syncStatus.pendingFromMac, id: \.id) { record in
                    syncPendingRow(record)
                }
            }
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

    private func syncPendingRow(_ record: SyncRecord) -> some View {
        let isAccepting = syncStatus.acceptingIds.contains(record.id)
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(record.title)
                    .font(Theme.Font.rowSubtitle.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(record.artist)
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                Task { await container?.syncEngine.acceptFromMac(record.id) }
            } label: {
                if isAccepting {
                    HStack(spacing: 6) {
                        ProgressView().tint(Theme.accent)
                        Text(Copy.Sync.downloading)
                    }
                } else {
                    Text(Copy.Sync.sendToSpotify)
                }
            }
            .font(Theme.Font.rowSubtitle.weight(.medium))
            .foregroundStyle(Theme.accent)
            .buttonStyle(.plain)
            .disabled(isAccepting)
        }
    }

    private func refreshInbox() {
        guard let container else { return }
        // Files already sent to Spotify are never "waiting", even when the
        // connected folder happens to be one the inbox also scans.
        let knownPaths = Set(((try? container.library.all()) ?? []).flatMap { $0.tracks.map(\.filePath) })
        inboxFiles = container.inbox.pendingFiles().filter { !knownPaths.contains($0.url.path) }
    }
}
