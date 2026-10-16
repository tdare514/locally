import SwiftUI
import UniformTypeIdentifiers

/// Which import flow the Import tab shows; `RootView` passes a requested
/// value from the library's empty state.
enum ImportKind: Hashable {
    case single, album
}

/// The Import tab's root, "Make a record" (#205). It owns the whole flow: both view models, the
/// kind, whether a record has started, the one beat driver both kinds share, the pickers and the
/// backdrop. Before a track is added it shows `ImportInvitation`; after, the record for the
/// current kind (`ImportSingleView` or `AlbumBuilderView`), then the Sent card (`ImportSentCard`) over
/// everything once sent.
struct ImportView: View {
    /// Set by the library's empty state ("Add your first single" / "Make an
    /// album"); applied and cleared when the tab appears.
    @Binding var requestedKind: ImportKind?

    @Environment(\.appContainer) private var container
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(SyncStatus.self) private var syncStatus

    @State private var kind: ImportKind = .single
    @State private var singleModel: ImportSingleViewModel?
    @State private var albumModel: AlbumBuilderViewModel?
    /// A track has been added: the record shows instead of the invitation.
    @State private var recordStarted = false
    @State private var driver = ImportBeatDriver()
    /// Bumped by Send to scroll the record back to the sleeve before the disc slides in.
    @State private var sleeveScrollRequest = 0
    /// True from the Send tap until the Sent card has closed or the send has failed.
    @State private var holdingForSent = false
    /// The Sent card, while it is up.
    @State private var sentCard: ImportSentInfo?

    /// Which use the one `.fileImporter` is open for. The kind lives here rather than in
    /// `isPickerPresented`, since SwiftUI flips that Bool false before the completion handler runs.
    private enum Picker: Equatable { case start, replace, add, replaceRow(UUID), cover }
    @State private var activePicker: Picker?
    @State private var isPickerPresented = false
    /// Raw bytes from the Files cover pick, handed to `CoverPicker` to crop.
    @State private var rawCoverPick: Data?

    /// The cover's backdrop colours, and whether that backdrop is showing over the studio one.
    @State private var palette = AmbientPalette.neutral
    @State private var backdropOn = false

    /// Files currently waiting in the share inbox, shown as a chip at the top.
    /// Checked on appear and whenever the app comes back to the foreground,
    /// since the share extension can only add to the inbox while this app
    /// isn't running.
    @State private var inboxFiles: [InboxFile] = []
    @State private var inboxRefreshTask: Task<Void, Never>?
    /// How many waiting files the user last dismissed the toast for; it
    /// comes back only when the count changes (new songs arrived).
    @State private var dismissedCount: Int?
    /// The toast shows for a few seconds when songs arrive, then tucks into
    /// the "N waiting" chip at the top; tapping the chip brings it back.
    @State private var toastVisible = false
    @State private var hideTask: Task<Void, Never>?
    /// Mirrors `toastVisible`/`dismissedCount` for the sync source: songs
    /// waiting on the Mac, offered separately from the share inbox above.
    @State private var syncToastVisible = false
    @State private var syncDismissedCount: Int?
    @State private var syncHideTask: Task<Void, Never>?

    init(requestedKind: Binding<ImportKind?>) {
        _requestedKind = requestedKind
    }

    var body: some View {
        NavigationStack {
            ZStack {
                // Studio backdrop at the back; the cover's own sits over it, at 0 until the
                // record has a cover and the beat's wash has started.
                StudioBackdrop()
                ArtworkBackdrop(palette: palette)
                    .ignoresSafeArea()
                    .opacity(backdropOn ? 1 : 0)
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: backdropOn ? Theme.Import.backdropFadeInDuration : Theme.Import.backdropFadeOutDuration),
                        value: backdropOn
                    )
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)

                VStack(spacing: 0) {
                    if hasChip {
                        chips
                            .padding(.horizontal, Theme.Spacing.pagePadding)
                            .padding(.top, 8)
                            .padding(.bottom, 4)
                    }
                    flow
                }
            }
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
            // The cover's colours reach the backdrop at the beat's `washAt` (at once when it is
            // skipped or with Reduce Motion); the palette is ready before the backdrop fades in.
            .task(id: driver.washedCover) {
                guard let data = driver.washedCover else {
                    backdropOn = false
                    return
                }
                palette = await Task.detached { ArtworkPalette.palette(forCover: data) }.value
                guard !Task.isCancelled else { return }
                backdropOn = true
            }
            .fullScreenCover(item: $sentCard) { info in
                ImportSentCard(
                    kind: info.kind,
                    cover: info.cover.flatMap { UIImage(data: $0) },
                    palette: info.cover == nil ? nil : palette,
                    spotifyInstalled: info.spotifyInstalled,
                    onOpenSpotify: finishSent,
                    onClose: finishSent
                )
            }
            .fileImporter(
                isPresented: $isPickerPresented,
                allowedContentTypes: activePicker == .cover ? [.image] : [.audio],
                allowsMultipleSelection: activePicker == .start || activePicker == .add
            ) { result in
                let picker = activePicker
                activePicker = nil
                guard case .success(let urls) = result, !urls.isEmpty else { return }
                handlePick(urls, for: picker)
            }
            // The tab bar sits straight on the backdrop, as in Settings; there is no page header.
            .toolbarBackground(.hidden, for: .tabBar)
            .toolbar(.hidden, for: .navigationBar)
        }
        .onAppear {
            makeModelsIfNeeded()
            applyRequestedKind()
            refreshInbox()
            if !inboxFiles.isEmpty, dismissedCount != inboxFiles.count { showToast() }
            if !syncStatus.pendingFromMac.isEmpty, syncDismissedCount != syncStatus.pendingFromMac.count { showSyncToast() }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active { refreshInbox() }
        }
        .onChange(of: requestedKind) { _, _ in applyRequestedKind() }
    }

    // MARK: Flow

    @ViewBuilder
    private var flow: some View {
        if let singleModel, let albumModel {
            if recordStarted {
                switch kind {
                case .single: ImportSingleView(model: singleModel, context: context)
                case .album: AlbumBuilderView(model: albumModel, context: context)
                }
            } else {
                ImportInvitation(onAddTrack: { present(.start) })
            }
        } else {
            Color.clear
        }
    }

    /// The kind switch is off while files load, during the send and while the Sent card is up.
    private var isLocked: Bool {
        ImportSendLock.isLocked(
            isLoadingTags: (singleModel?.isLoadingTags ?? false) || (albumModel?.isLoadingTags ?? false),
            isSending: (singleModel?.isSending ?? false) || (albumModel?.isSending ?? false),
            holdingForSent: holdingForSent
        )
    }

    private var context: ImportRecordContext {
        ImportRecordContext(
            driver: driver,
            kind: Binding(get: { kind }, set: { switchKind(to: $0) }),
            rawCoverPick: $rawCoverPick,
            sleeveScrollRequest: sleeveScrollRequest,
            isSendHeld: holdingForSent,
            isBusy: isLocked,
            onAddTrack: { present(kind == .single ? .replace : .add) },
            onReplaceTrack: { present(.replaceRow($0)) },
            onPickCoverFromFiles: { present(.cover) },
            onSend: send,
            glowColors: Theme.coverGlowColors(driver.washedCover == nil ? nil : palette)
        )
    }

    private func makeModelsIfNeeded() {
        guard singleModel == nil, albumModel == nil, let container else { return }
        singleModel = ImportSingleViewModel(importer: container.importer, coordinator: container.coordinator, inbox: container.inbox)
        albumModel = AlbumBuilderViewModel(importer: container.importer, coordinator: container.coordinator, inbox: container.inbox)
    }

    private func present(_ picker: Picker) {
        // A track can't change under a send or a tag read (the cover still can).
        if picker != .cover, isLocked { return }
        activePicker = picker
        isPickerPresented = true
    }

    private func handlePick(_ urls: [URL], for picker: Picker?) {
        switch picker {
        case .start:
            // One file keeps the current kind; two or more make an album.
            if urls.count >= 2 { switchKind(to: .album) }
            recordStarted = true
            Task {
                switch kind {
                case .single: await singleModel?.pick(url: urls[0])
                case .album: await albumModel?.addFiles(urls)
                }
            }
        case .replace:
            Task { await singleModel?.pick(url: urls[0]) }
        case .add:
            Task { await albumModel?.addFiles(urls) }
        case .replaceRow(let id):
            Task { await albumModel?.replaceRow(id, with: urls[0]) }
        case .cover:
            let url = urls[0]
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            rawCoverPick = try? Data(contentsOf: url)
        case nil:
            break
        }
    }

    /// Switching kind keeps the draft once a record has started; before that it only picks the kind.
    private func switchKind(to newKind: ImportKind) {
        guard newKind != kind, !isLocked else { return }
        if recordStarted, let singleModel, let albumModel {
            switch newKind {
            case .album: ImportKindSwitch.singleToAlbum(singleModel, into: albumModel)
            case .single: ImportKindSwitch.albumToSingle(albumModel, into: singleModel)
            }
        }
        kind = newKind
    }

    private func applyRequestedKind() {
        guard let requestedKind else { return }
        switchKind(to: requestedKind)
        self.requestedKind = nil
    }

    /// The inbox toast's "add as singles" / "add as album": start the record and hand the files
    /// to the model directly.
    private func startFromInbox(as newKind: ImportKind) {
        guard !isLocked else { return }
        let files = inboxFiles
        inboxFiles = []
        switchKind(to: newKind)
        recordStarted = true
        Task {
            switch newKind {
            case .single: await singleModel?.startInboxQueue(files)
            case .album: await albumModel?.addFiles(fromInbox: files)
            }
        }
    }

    /// Send: the keyboard closes and the record scrolls back to the sleeve (and settles), so the
    /// disc is seen; the disc slides into the sleeve while the model sends. On success the Sent
    /// card pops up once the disc is in; on failure the disc eases back out and the footer shows
    /// the message.
    private func send() {
        guard !holdingForSent, !isLocked, let singleModel, let albumModel else { return }
        // The kind is fixed here: the lock keeps the switch off, and the send uses only this.
        let sendKind = kind
        holdingForSent = true
        Task {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            sleeveScrollRequest += 1
            if !reduceMotion { try? await Task.sleep(for: .seconds(Theme.Import.sendScrollSettle)) }
            driver.sealForSend(reduced: reduceMotion)
            let completed: Bool
            let cover: Data?
            switch sendKind {
            case .single:
                await singleModel.send()
                completed = singleModel.completedRelease != nil
                cover = singleModel.coverData
            case .album:
                await albumModel.send()
                completed = albumModel.completedRelease != nil
                cover = albumModel.coverData
            }
            guard completed else {
                holdingForSent = false
                driver.sendFailed(reduced: reduceMotion)
                return
            }
            try? await Task.sleep(for: driver.sealRemaining(reduced: reduceMotion))
            withoutAnimation { sentCard = ImportSentInfo(kind: sendKind, cover: cover) }
        }
    }

    /// The Sent card's Open in Spotify and Close: the card goes at once (the card ran its own
    /// drop-away) and the page goes back to the invitation with the beat reset, unless the single's
    /// share queue loads a next file, which stays on the record.
    private func finishSent() {
        withoutAnimation { sentCard = nil }
        startNext()
    }

    private func startNext() {
        driver.reset()
        switch kind {
        case .single:
            let continues = !(singleModel?.pendingInboxQueue.isEmpty ?? true)
            singleModel?.reset()
            recordStarted = continues
        case .album:
            albumModel?.reset()
            recordStarted = false
        }
        holdingForSent = false
    }

    /// Presents or dismisses with the system's slide switched off: the Sent card runs its own motion.
    private func withoutAnimation(_ body: () -> Void) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction, body)
    }

    // MARK: Chips

    private var showsInboxChip: Bool { !inboxFiles.isEmpty && !toastVisible }
    private var showsSyncChip: Bool { !syncStatus.pendingFromMac.isEmpty && !syncToastVisible }
    private var hasChip: Bool { showsInboxChip || showsSyncChip }

    /// The slim top row: the waiting chips, shown only when there is one.
    private var chips: some View {
        HStack(spacing: 10) {
            if showsInboxChip {
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
            if showsSyncChip {
                Button {
                    showSyncToast(autoHide: false)
                } label: {
                    Text(Copy.Sync.pendingFromDevices(count: syncStatus.pendingFromMac.count))
                        .font(Theme.Font.badge)
                        .foregroundStyle(.black)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Theme.accent, in: Capsule())
                }
                .buttonStyle(.plain)
                .transition(.scale.combined(with: .opacity))
            }
            Spacer(minLength: 0)
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
                    Button(Copy.Inbox.addAsSingles) { startFromInbox(as: .single) }
                    Button(Copy.Inbox.makeAnAlbum) { startFromInbox(as: .album) }
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

    /// The "From your devices" toast, listing each pending release with its own
    /// "Send to Spotify" action (a spinner while `SyncStatus.acceptingIds`
    /// includes it) plus "Send all" when there's more than one.
    private var syncToast: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Text(Copy.Sync.fromYourDevices)
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
                Text(Copy.Sync.originLabel(record.origin))
                    .font(Theme.Font.dropZoneHint)
                    .foregroundStyle(Theme.textDim)
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
        let inbox = container.inbox
        inboxRefreshTask?.cancel()
        inboxRefreshTask = Task {
            // The sweep lists the Inbox and stats every file; run it off the
            // main actor and only reload the list once it has finished.
            _ = await Task.detached(priority: .utility) { inbox.sweepOrphans() }.value
            guard !Task.isCancelled else { return }
            loadInboxFiles()
        }
    }

    private func loadInboxFiles() {
        guard let container else { return }
        // Files already sent to Spotify are never "waiting", even when the
        // connected folder happens to be one the inbox also scans.
        let knownPaths = Set(((try? container.library.all()) ?? []).flatMap { $0.tracks.map(\.filePath) })
        inboxFiles = container.inbox.pendingFiles().filter { !knownPaths.contains($0.url.path) }
    }
}

#if DEBUG
/// The gallery's prefilled flow: models, driver and kind built by the caller, with no container.
struct ImportViewPreset {
    let single: ImportSingleViewModel
    let album: AlbumBuilderViewModel
    let driver: ImportBeatDriver
    let kind: ImportKind
    /// The Sent card to show over the record, with its cover (`import-sent-*`).
    var sent: ImportSentInfo?
}

extension ImportView {
    /// DEBUG only: the real Import tab on prefilled models (`ComponentGallery`, `import-record-*`).
    init(preset: ImportViewPreset) {
        self.init(requestedKind: .constant(nil))
        _singleModel = State(initialValue: preset.single)
        _albumModel = State(initialValue: preset.album)
        _driver = State(initialValue: preset.driver)
        _kind = State(initialValue: preset.kind)
        _recordStarted = State(initialValue: true)
        _sentCard = State(initialValue: preset.sent)
    }
}
#endif
