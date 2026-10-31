import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// A release's edit screen, styled as "the record": the cover's colours wash the
/// screen, the cover is a record sleeve with a disc peeking out, title/artist/year/genre
/// are inline fields under it, and the tracks sit in a translucent panel. Saving plays the
/// sleeve's tuck-and-spin from a floating dock. Opened from `LibraryView` via
/// `navigationDestination(for: Release.self)`.
struct ReleaseDetailView: View {
    @Environment(\.appContainer) private var container
    @Environment(\.playback) private var playback
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .headline) private var tracksHeadingSize: CGFloat = 17

    let release: Release
    /// DEBUG screenshots open the page already in edit mode.
    var startsEditing = false
    /// With `startsEditing`, the song to scroll to once the page is in edit mode (#364).
    var scrollsToTrackID: UUID?
    /// The track the release was opened from (#362): scrolled into view and washed once per push.
    var highlightTrackID: UUID?
    /// DEBUG screenshots hold the wash at full strength instead of fading it.
    var holdsHighlight = false
    @State private var highlight: Double = 0
    @State private var didHighlight = false
    /// A song the long-press menu's Edit asked to scroll to; cleared once the page has scrolled there.
    @State private var editScrollTrackID: UUID?
    @Environment(\.openURL) private var openURL
    @Environment(\.openSong) private var openSong
    /// How far the wash reaches past the row's text; less at large text so it stays inside the screen edge.
    private var washBleed: CGFloat { dynamicTypeSize.isAccessibilitySize ? 4 : min(8, Theme.Immersive.recordRowSideInset / 2) }
    @AccessibilityFocusState private var focusedTrackID: UUID?

    @State private var model: ReleaseDetailViewModel?
    @State private var isPresentingFileImporter = false
    @State private var isPresentingCoverSource = false
    @State private var isPresentingPhotos = false
    @State private var recentCovers: [RecentCover] = []
    /// The choice made in the cover sheet, acted on once the sheet has closed (Photos and
    /// Files cannot present while it is still on screen).
    @State private var pendingCoverChoice: CoverChoiceSheet.Choice?
    @State private var isPresentingDeleteConfirm = false
    @State private var shareTarget: ShareTarget?
    @State private var isPresentingReview = false
    /// "Add to collection" (#350): what is being added, and the model behind the sheet.
    @State private var addTarget: AddToCollectionTarget?
    @State private var collectionsModel: CollectionsModel?
    @State private var isPresentingDiscardConfirm = false
    /// Whether Discard also leaves the page (Back) or only edit mode (Cancel).
    @State private var photosItem: PhotosPickerItem?
    /// Raw bytes from the Files or Photos cover pick, handed to `CoverPicker` to
    /// crop; see `CoverPicker.rawPick`.
    @State private var rawCoverPick: Data?
    @State private var palette = AmbientPalette.neutral
    /// The decoded cover and the bytes it came from. Kept in state because the sleeve
    /// treats a new `UIImage` object as a cover swap, so one must not be made per render.
    @State private var coverImage: UIImage?
    @State private var coverImageData: Data?

    var body: some View {
        Group {
            if let model {
                content(model)
            } else {
                Color.clear
            }
        }
        .task {
            if model == nil, let container {
                PerfSignpost.begin(.releaseFirstCover)
                PerfSignpost.begin(.releaseLoad)
                let made = ReleaseDetailViewModel(release: release, coordinator: container.coordinator, coverStore: container.coverStore, syncApi: container.syncApi, isSignedIn: { container.syncAccount.deviceToken != nil })
                coverImage = made.coverData.flatMap(UIImage.init(data:))
                coverImageData = made.coverData
                if startsEditing {
                    made.beginEditing()
                    editScrollTrackID = scrollsToTrackID
                }
                model = made
                collectionsModel = container.makeCollectionsModel()
                PerfSignpost.end(.releaseLoad)
            }
            await model?.loadPlays()
            await model?.loadMissingLengths()
        }
    }

    @ViewBuilder
    private func content(_ model: ReleaseDetailViewModel) -> some View {
        let isAlbum = model.kind == .album
        ZStack {
            ArtworkBackdrop(palette: palette)
            .ignoresSafeArea()

            ScrollViewReader { proxy in
            List {
                Section {
                    hero(model)
                    if model.isEditing {
                        fields(model)
                    } else {
                        details(model)
                    }
                    ClearSectionEnd()
                }
                .recordListSection()

                if !model.isEditing {
                    Section {
                        viewTracks(model)
                        ClearSectionEnd()
                    }
                    .recordListSection()
                }

                if model.isEditing {
                Section {
                    tracksHeader(model.trackRows.count).panelRow(.top)
                    if model.isEditing && model.trackRows.count >= 2 {
                        reorderHint.panelRow(.middle).transition(.opacity)
                    }
                    trackRows(model, proxy: proxy)
                    if model.hasPlays { playsFootnote.panelRow(.middle) }
                    if model.isAdopted { adoptedNote.panelRow(.middle) }
                    if isAlbum { playlistGuide(model).panelRow(.middle) }
                    messages(model)
                    if model.isEditing {
                        deleteButton(model).panelRow(.bottom).transition(.opacity)
                    }
                }
                .panelListSection()
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.custom(Theme.Spacing.editorSectionGap))
            .environment(\.defaultMinListRowHeight, 0)
            .scrollContentBackground(.hidden)
            .task { await highlightTrack(in: model, proxy: proxy) }
            .onDisappear { clearHighlight() }
            .task(id: editScrollTrackID) { await scrollToEditedTrack(in: model, proxy: proxy) }
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        // Edit mode is the iOS edit pattern: Cancel takes the back button's place, so the only ways
        // out are Cancel (asking first when there are edits) and Save.
        .navigationBarBackButtonHidden(model.isEditing)
        .toolbar {
            if model.isEditing {
                ToolbarItem(placement: .topBarLeading) {
                    Button(Copy.Release.cancel) {
                        if model.hasChanges {
                            isPresentingDiscardConfirm = true
                        } else {
                            model.discardChanges()
                        }
                    }
                    .disabled(model.isSaving)
                }
            } else if !model.isAdopted {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if model.canShare {
                        Button(Copy.Share.share) { shareTarget = ShareTarget(trackId: nil, subject: model.title) }
                    }
                    Button(Copy.Release.edit) { model.beginEditing() }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // Mode changes are instant; only the dock fades (0.25 s, signature easing; none under Reduce Motion).
            ZStack {
                if model.isEditing {
                    ReleaseDock(model: model) {
                        model.commitFeaturingDraft()
                        isPresentingReview = true
                    }
                        .transition(.opacity)
                }
            }
            .animation(reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: Theme.Immersive.modeFade), value: model.isEditing)
        }
        .sheet(isPresented: Binding(get: { featuringIndex(model) != nil }, set: { if !$0 { model.featuringRowID = nil } })) {
            if let id = model.featuringRowID, let index = featuringIndex(model) {
                FeaturingSheet(trackTitle: model.trackRows[index].title, names: featuringBinding(id, in: model)) { model.featuringRowID = nil }
            }
        }
        .sheet(item: $shareTarget) { target in
            if let container {
                ShareSheet(
                    model: ShareSheetModel(
                        releaseId: model.releaseId, subject: target.subject, trackIds: target.trackId.map { [$0] },
                        isSignedIn: model.isSignedInForSharing, api: container.syncApi, groupStore: UserDefaultsShareGroupStore(),
                        reshareShareId: model.sharedFrom?.shareId),
                    coverImage: coverImage
                ) { shareTarget = nil }
            }
        }
        .sheet(item: $addTarget) { target in
            if let collectionsModel {
                AddToCollectionSheet(model: collectionsModel, items: target.items) { addTarget = nil }
            }
        }
        .sheet(isPresented: $isPresentingReview) {
            ReleaseReviewSheet(model: model) { isPresentingReview = false }
        }
        .confirmationDialog(
            Copy.Release.discardTitle,
            isPresented: $isPresentingDiscardConfirm,
            titleVisibility: .visible
        ) {
            Button(Copy.Release.discard, role: .destructive) {
                model.discardChanges()
            }
            Button(Copy.Release.keepEditingDiscard, role: .cancel) {}
        }
        // Palette from the cover at 24x24, off the main thread; the previous palette
        // stays on screen until the new one is ready, and the backdrop cross-fades.
        .task(id: model.coverData) {
            let data = model.coverData
            if data != coverImageData {
                coverImage = data.flatMap(UIImage.init(data:))
                coverImageData = data
            }
            palette = await Task.detached { ArtworkPalette.palette(forCover: data) }.value
        }
        .task(id: photosItem) {
            guard let photosItem else { return }
            if let data = try? await photosItem.loadTransferable(type: Data.self) {
                rawCoverPick = data
            }
            // Clear the selection so picking the same photo again re-triggers.
            self.photosItem = nil
        }
        .background {
            // Hosts only the crop sheet: both pick paths land in `rawCoverPick`.
            CoverPicker(
                imageData: Binding(get: { model.coverData }, set: { model.coverData = $0 }),
                rawPick: $rawCoverPick,
                style: .cropHostOnly
            ) {}
            .frame(width: 0, height: 0)
            .opacity(0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .background {
            Color.clear
                .photosPicker(isPresented: $isPresentingPhotos, selection: $photosItem, matching: .images)
        }
        .fileImporter(isPresented: $isPresentingFileImporter, allowedContentTypes: [.image]) { result in
            guard case .success(let url) = result else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            rawCoverPick = try? Data(contentsOf: url)
        }
        .confirmationDialog(
            Copy.Detail.deleteConfirmTitle,
            isPresented: $isPresentingDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button(Copy.Detail.deleteConfirmAction, role: .destructive) {
                Task { await model.delete() }
            }
            Button(Copy.Detail.deleteConfirmCancel, role: .cancel) {}
        } message: {
            if let warning = model.deleteShareWarning { Text(warning) }
        }
        .onChange(of: model.isDeleted) { _, isDeleted in
            if isDeleted { dismiss() }
        }
    }

    // MARK: Hero and fields

    private func hero(_ model: ReleaseDetailViewModel) -> some View {
        HStack {
            Spacer(minLength: 0)
            RecordSleeve(cover: coverImage, ceremony: model.saveCount, showsAddCaption: model.isEditing) {
                isPresentingCoverSource = true
            }
            // View mode: the sleeve is only a picture, not a button.
            .allowsHitTesting(model.isEditing)
            .accessibilityRemoveTraits(model.isEditing ? [] : .isButton)
            // In view mode VoiceOver reads it as the cover, an image, not "Change cover art".
            .modifier(ViewModeCoverAccessibility(isEditing: model.isEditing))
            .endsSignpost(.releaseFirstCover, when: coverImage != nil)
            .sheet(isPresented: $isPresentingCoverSource, onDismiss: { applyCoverChoice(model) }) {
                // Remove is left out: saving a release with its cover removed is not supported
                // (`ReleaseChanges.cover` nil means "unchanged"), so it would do nothing.
                CoverChoiceSheet(recents: recentCovers, hasCover: false) { choice in
                    pendingCoverChoice = choice
                    isPresentingCoverSource = false
                }
            }
            Spacer(minLength: 0)
        }
        // Load when the page appears, then each time the sheet opens, so a release saved or
        // synced meanwhile shows; a cancelled load keeps the list already on screen.
        .task(id: isPresentingCoverSource) {
            guard let container, isPresentingCoverSource || recentCovers.isEmpty else { return }
            let loaded = await RecentCoversLoader(library: container.library, coverStore: container.coverStore).load()
            guard !Task.isCancelled else { return }
            recentCovers = loaded
        }
        // Room inside the row for the sleeve's shadow, which the row would otherwise clip.
        .padding(.top, Theme.Immersive.sleeveShadowRoomTop)
        .padding(.bottom, Theme.Immersive.sleeveShadowRoomBottom)
        .clearRow(top: 0, bottom: 0)
    }

    private func applyCoverChoice(_ model: ReleaseDetailViewModel) {
        guard let choice = pendingCoverChoice else { return }
        pendingCoverChoice = nil
        switch choice {
        case .recent(let recent):
            // A recent cover was cropped when first saved, so it skips the crop.
            if let data = container?.coverStore.load(recent.id) { model.coverData = data }
        case .remove:
            model.coverData = nil
        case .photos: isPresentingPhotos = true
        case .files: isPresentingFileImporter = true
        }
    }

    @ViewBuilder
    private func fields(_ model: ReleaseDetailViewModel) -> some View {
        let gap = Theme.Immersive.labeledFieldRowGap
        LabeledField(Copy.Import.fieldTitle, placeholder: Copy.Import.titlePlaceholder(for: model.kind), text: Binding(get: { model.title }, set: { model.title = $0 }), font: Theme.ScaledFont.fieldTitle, metricsStyle: .title3, wraps: true, isEditable: model.isEditing)
            .clearRow(top: 0, bottom: gap)
        ArtistField(text: Binding(get: { model.artist }, set: { model.artist = $0 }), isEditable: model.isEditing && !model.isAdopted)
            .clearRow(top: 0, bottom: gap)
        if model.kind == .single {
            FeaturingField(names: Binding(get: { model.singleFeaturing }, set: { model.singleFeaturing = $0 }), draft: Binding(get: { model.featuringDraft }, set: { model.featuringDraft = $0 }), isEditable: model.isEditing && !model.isAdopted)
                .clearRow(top: 0, bottom: model.isEditing || !model.singleFeaturing.isEmpty ? gap : 0)
        }
        ReleaseDateGenreRows(releaseDate: Binding(get: { model.releaseDateText }, set: { model.releaseDateText = $0 }), genre: Binding(get: { model.genre }, set: { model.genre = $0 }), isEditable: model.isEditing, message: model.releaseDateMessage)
            .clearRow(top: 0, bottom: 0)
    }

    // MARK: View mode (#296)

    /// The Mac's details: meta line, title, artist, "Release date 17 May 2024   Genre Rap".
    private func details(_ model: ReleaseDetailViewModel) -> some View {
        ReleaseDetailsView(kind: model.kind, trackCount: model.trackRows.count, title: model.title, artist: model.artist, featuring: model.kind == .single ? model.singleFeaturing : [], releaseDate: model.releaseDateText, genre: model.genre)
            .clearRow(top: 0, bottom: 0)
    }

    /// The tracks with no card: a "Tracks" heading, the quiet header row, then a row per track with a
    /// hairline between rows. Playlists aren't a column on the phone.
    @ViewBuilder
    private func viewTracks(_ model: ReleaseDetailViewModel) -> some View {
        let headings = model.discHeadings
        let last = model.trackRows.count - 1
        if model.isShareBlocked {
            Text(Copy.Share.reshareNotAllowed)
                .themeFont(.rowSubtitle)
                .foregroundStyle(Theme.secondaryText)
                .frame(maxWidth: .infinity, alignment: .leading)
                .clearRow(top: 0, bottom: 12)
        }
        Text(Copy.Import.tracks)
            .font(.system(size: tracksHeadingSize, weight: .bold))
            .foregroundStyle(Theme.primaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
            .clearRow(top: 0, bottom: 8)
        ReleaseTrackHeader()
            .padding(.bottom, 6)
            .clearRow(top: 0, bottom: 0)
        ForEach(Array(model.trackRows.enumerated()), id: \.element.id) { index, row in
            if headings.indices.contains(index), let disc = headings[index] {
                DiscHeading(number: disc).clearRow(top: 8, bottom: 4)
            }
            let seconds = row.durationSec ?? model.readLengths[row.id]
            ReleaseTrackRow(
                number: index + 1,
                title: model.kind == .single ? model.title : row.title,
                featuring: model.kind == .album ? row.featuring : [],
                artist: model.artist.isEmpty ? Copy.Detail.unknownArtist : model.artist,
                plays: model.playTotal(for: row),
                time: TrackLength.format(seconds),
                timeSpoken: TrackLength.spoken(seconds),
                play: playControl(for: row.id, in: model.savedRelease),
                highlight: row.id == highlightTrackID ? highlight : 0,
                onOpenSong: songOpener(for: row, in: model)
            )
            .background {
                if row.id == highlightTrackID {
                    trackHighlight(tint: highlightTint)
                }
            }
            .id(row.id)
            .accessibilityValue(row.id == highlightTrackID && highlight > 0 ? Copy.Detail.trackHighlighted : "")
            .accessibilityFocused($focusedTrackID, equals: row.id)
            .overlay(alignment: .bottom) {
                if index != last { Rectangle().fill(Theme.Track.separatorTint).frame(height: 1) }
            }
            .trackActions(trackActions(for: row, in: model))
            .swipeActions(edge: .trailing) {
                Button {
                    addTarget = AddToCollectionTarget(items: [.track(releaseId: model.releaseId, trackId: row.id)])
                } label: {
                    Label(Copy.Collections.addToCollection, systemImage: "text.badge.plus")
                }
                .tint(Theme.accent)
            }
            .clearRow(top: 0, bottom: 0)
        }
        Button {
            addTarget = AddToCollectionTarget(items: [.release(model.releaseId)])
        } label: {
            Label(Copy.Collections.addToCollection, systemImage: "text.badge.plus")
                .themeFont(.rowTitle)
                .foregroundStyle(Theme.accent)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
        .clearRow(top: 8, bottom: 0)
        if model.hasPlays { playsFootnote.clearRow(top: 12, bottom: 0) }
        if model.isAdopted { adoptedNote.clearRow(top: 8, bottom: 0) }
        if model.kind == .album { playlistGuide(model).clearRow(top: 8, bottom: 0) }
        viewMessages(model)
    }

    /// The long-press menu of a song row (#364). No Go to album: this is the album.
    private func trackActions(for row: ReleaseDetailViewModel.TrackRow, in model: ReleaseDetailViewModel) -> TrackActions {
        let releaseId = model.releaseId
        var actions = TrackActions(target: .track(releaseId: releaseId, trackId: row.id), release: model.savedRelease)
        actions.addToCollection = { addTarget = AddToCollectionTarget(items: [.track(releaseId: releaseId, trackId: row.id)]) }
        if model.canShareTracks {
            actions.share = { shareTarget = ShareTarget(trackId: row.id, subject: model.kind == .single ? model.title : row.title) }
        }
        if !model.isAdopted {
            actions.edit = {
                model.beginEditing()
                editScrollTrackID = row.id
            }
        }
        if let url = ArtistLink.url(forName: ArtistNames.splitArtistFeaturing(model.savedRelease.artist).artist) {
            actions.goToArtist = { openURL(url) }
        }
        actions.songInfo = songOpener(for: row, in: model)
        return actions
    }

    /// Opens the song's page (#365) from the title tap and "Song info"; nil where no stack shows songs.
    private func songOpener(for row: ReleaseDetailViewModel.TrackRow, in model: ReleaseDetailViewModel) -> (() -> Void)? {
        guard let openSong else { return nil }
        let route = SongRoute(release: model.savedRelease, trackId: row.id)
        return { openSong(route) }
    }

    /// After Edit on a song: the edit list is long and lazy, so the song's edit row may not exist yet. This scrolls
    /// to its id without animation to bring the row in; the row's `onAppear` (`didShowEditRow`) then centres it
    /// and consumes the request. No timer: the row appearing is the signal that the edit rows are ready.
    private func scrollToEditedTrack(in model: ReleaseDetailViewModel, proxy: ScrollViewProxy) async {
        guard let id = editScrollTrackID, model.isEditing else { return }
        proxy.scrollTo(id, anchor: .center)
    }

    /// An edit row appeared: if it is the song Edit was chosen on, centres it and clears the request.
    private func didShowEditRow(_ id: UUID, proxy: ScrollViewProxy) {
        guard editScrollTrackID == id else { return }
        editScrollTrackID = nil
        if reduceMotion {
            proxy.scrollTo(id, anchor: .center)
        } else {
            withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.3)) { proxy.scrollTo(id, anchor: .center) }
        }
    }

    /// Once the push has settled: scrolls the opened-from track to the middle, washes it in, holds, and
    /// fades it out. Opacity only; Reduce Motion jumps the scroll. Plays once per push.
    private func highlightTrack(in model: ReleaseDetailViewModel, proxy: ScrollViewProxy) async {
        guard let id = highlightTrackID, !didHighlight, !model.isEditing, model.trackRows.contains(where: { $0.id == id }) else { return }
        try? await Task.sleep(for: .seconds(Theme.Track.highlightDelay))
        guard !Task.isCancelled else { return }
        didHighlight = true
        if reduceMotion {
            proxy.scrollTo(id, anchor: .center)
        } else {
            withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.3)) { proxy.scrollTo(id, anchor: .center) }
        }
        focusedTrackID = id
        withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: Theme.Track.highlightFadeIn)) { highlight = 1 }
        guard !holdsHighlight else { return }
        try? await Task.sleep(for: .seconds(Theme.Track.highlightFadeIn + Theme.Track.highlightHold))
        guard !Task.isCancelled else { clearHighlight(); return }
        withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: Theme.Track.highlightFadeOut)) { highlight = 0 }
    }

    /// Drops the glow at once, so a page left mid-glow shows its row plain on return (the glow plays once per push).
    private func clearHighlight() {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { highlight = 0 }
    }

    /// The row's play button (#336), or nil when the release can't play here (an adopted one).
    private func playControl(for trackID: UUID, in release: Release) -> TrackPlayControl? {
        guard let playback, let action = playback.playAction(release: release, trackID: trackID) else { return nil }
        return TrackPlayControl(
            isCurrent: playback.isCurrent(trackID, in: release), isPlaying: playback.isPlaying,
            isMissing: playback.missingTrackIDs.contains(trackID), action: action
        )
    }

    @ViewBuilder
    private func viewMessages(_ model: ReleaseDetailViewModel) -> some View {
        if let statusMessage = model.statusMessage {
            Text(statusMessage)
                .themeFont(.meta)
                .foregroundStyle(Theme.secondaryText)
                .clearRow(top: 8, bottom: 0)
        }
        if let errorMessage = model.errorMessage {
            Text(errorMessage)
                .themeFont(.rowSubtitle)
                .foregroundStyle(Theme.danger)
                .clearRow(top: 8, bottom: 0)
        }
    }

    // MARK: Panel rows

    private func tracksHeader(_ count: Int) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(Copy.Import.tracks)
                .themeFont(.sectionTitle)
                .foregroundStyle(Theme.primaryText)
            Spacer()
            Text(Copy.Detail.fileCount(count))
                .themeFont(.meta)
                .foregroundStyle(Theme.secondaryText)
        }
    }

    private var reorderHint: some View {
        Text(Copy.Detail.reorderHint)
            .themeFont(.dropZoneHint)
            .foregroundStyle(Theme.secondaryText)
            .accessibilityIdentifier("reorder-hint")
    }

    // Long-press drag via `.onMove` without an Edit-mode toolbar button (iOS 16+).
    // Singles and one-track albums leave move disabled so the gesture doesn't
    // fight the title field.
    private func trackRows(_ model: ReleaseDetailViewModel, proxy: ScrollViewProxy) -> some View {
        let headings = model.discHeadings
        return ForEach(Array(model.trackRows.enumerated()), id: \.element.id) { index, row in
            if headings.indices.contains(index), let disc = headings[index] {
                DiscHeading(number: disc).panelRow(.middle)
            }
            // A single's only track takes its title from the Title field above,
            // so its row shows that live value rather than the (only saved-on-send)
            // track row title.
            let seconds = row.durationSec ?? model.readLengths[row.id]
            TrackRow(
                number: index + 1,
                title: model.kind == .single ? model.title : row.title,
                featuring: model.kind == .album ? row.featuring : [],
                onFeat: model.kind == .album && model.isEditing ? { model.featuringRowID = row.id } : nil,
                titleBinding: model.kind == .album && model.isEditing
                    ? Binding(get: { row.title }, set: { setTitle($0, for: row, in: model) })
                    : nil,
                plays: model.playTotal(for: row).map(Copy.Detail.playCount),
                length: TrackLength.format(seconds),
                lengthSpoken: TrackLength.spoken(seconds),
                showsGrip: model.isEditing && model.trackRows.count >= 2,
                discActions: model.discActions(at: index),
                onStartDisc: { model.startDisc(at: index) },
                onJoinDisc: { model.joinPreviousDisc(at: index) }
            )
            .importTrackRow(
                isFirst: index == 0 || (headings.indices.contains(index) && headings[index] != nil),
                isLast: index == model.trackRows.count - 1 || (headings.indices.contains(index + 1) && headings[index + 1] != nil)
            )
            .onAppear { didShowEditRow(row.id, proxy: proxy) }
        }
        .onMove(perform: model.isEditing && model.trackRows.count >= 2 ? model.moveTracks : nil)
    }

    /// One line under the tracks saying where the play totals come from.
    private var playsFootnote: some View {
        Text(Copy.Detail.playsAcrossDevices)
            .themeFont(.dropZoneHint)
            .foregroundStyle(Theme.textDim)
    }

    /// Says where an adopted release's files are: they never come to this phone.
    private var adoptedNote: some View {
        Text(Copy.Detail.adoptedNote)
            .themeFont(.dropZoneHint)
            .foregroundStyle(Theme.textDim)
    }

    private func playlistGuide(_ model: ReleaseDetailViewModel) -> some View {
        DisclosureGroup(Copy.Detail.makeItAPlaylist) {
            PlaylistGuide(albumTitle: model.title)
        }
        .themeFont(.body)
        .foregroundStyle(Theme.primaryText)
        .frame(minHeight: Theme.Immersive.panelActionMinHeight)
    }

    /// The status line (quiet: it carries the Spotify rescan guidance) and the error line.
    @ViewBuilder
    private func messages(_ model: ReleaseDetailViewModel) -> some View {
        if let statusMessage = model.statusMessage {
            Text(statusMessage)
                .themeFont(.meta)
                .foregroundStyle(Theme.secondaryText)
                .panelRow(.middle)
        }
        if let errorMessage = model.errorMessage {
            Text(errorMessage)
                .themeFont(.rowSubtitle)
                .foregroundStyle(Theme.danger)
                .panelRow(.middle)
        }
    }

    private func deleteButton(_ model: ReleaseDetailViewModel) -> some View {
        Button {
            // Ask what is shared first, so the confirm can say who loses access.
            Task {
                await model.loadShareImpact()
                isPresentingDeleteConfirm = true
            }
        } label: {
            Text(Copy.Detail.delete)
        }
        .buttonStyle(TextButtonStyle(color: Theme.danger))
        .frame(maxWidth: .infinity, minHeight: Theme.Immersive.panelActionMinHeight, alignment: .leading)
    }

    private func glowColorsFor(_ palette: AmbientPalette) -> [Color] {
        Theme.coverGlowColors(coverImage == nil ? nil : palette)
    }

    private var glowColors: [Color] { glowColorsFor(palette) }

    /// The brightest of the cover's glow colours, or the accent with no cover (#362).
    private var highlightTint: Color {
        guard coverImage != nil, let base = glowColors.max(by: { UIColor($0).hsbBrightness < UIColor($1).hsbBrightness }) else { return Theme.accent }
        // The palette colours are dark by design; lift the brightest to a glow, keeping its hue.
        var h: CGFloat = 0, sat: CGFloat = 0, b: CGFloat = 0
        UIColor(base).getHue(&h, saturation: &sat, brightness: &b, alpha: nil)
        return Color(hue: h, saturation: sat, brightness: max(b, Theme.Track.highlightMinBrightness))
    }

    /// The glow behind the track a release was opened from: a fake-glass wash in the cover's colour, a rim,
    /// a soft outer glow and a needle cue at the leading edge. Only opacity and the cue's scale animate.
    private func trackHighlight(tint: Color) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Track.highlightCornerRadius)
        return ZStack(alignment: .leading) {
            shape
                .fill(LinearGradient(colors: [tint.opacity(Theme.Track.highlightLeading), tint.opacity(Theme.Track.highlightTrailing)], startPoint: .leading, endPoint: .trailing))
                .shadow(color: tint.opacity(Theme.Track.highlightGlow), radius: Theme.Track.highlightGlowRadius)
            shape.strokeBorder(
                LinearGradient(colors: [.white.opacity(Theme.Track.highlightRimTop), .white.opacity(Theme.Track.highlightRim)], startPoint: .top, endPoint: .bottom),
                lineWidth: 1
            )
            Capsule()
                .fill(tint)
                .frame(width: Theme.Track.cueWidth, height: Theme.Track.cueHeight)
                .scaleEffect(y: reduceMotion ? 1 : Theme.Track.cueFromScale + (1 - Theme.Track.cueFromScale) * highlight)
                .padding(.leading, 2)
                .padding(.top, Theme.Track.cueTopInset)
                .frame(maxHeight: .infinity, alignment: .top)
        }
        .opacity(highlight)
        .padding(.horizontal, -washBleed)
        .padding(.vertical, -4)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func featuringIndex(_ model: ReleaseDetailViewModel) -> Int? {
        model.featuringRowID.flatMap { id in model.trackRows.firstIndex { $0.id == id } }
    }

    private func featuringBinding(_ id: UUID, in model: ReleaseDetailViewModel) -> Binding<[String]> {
        Binding(
            get: { model.trackRows.first { $0.id == id }?.featuring ?? [] },
            set: { names in
                if let index = model.trackRows.firstIndex(where: { $0.id == id }) { model.trackRows[index].featuring = names }
            }
        )
    }

    /// Sets a track row's title by its stable `Track.id` (not index), so it
    /// stays correct while `.onMove` changes positions.
    private func setTitle(_ newValue: String, for row: ReleaseDetailViewModel.TrackRow, in model: ReleaseDetailViewModel) {
        if let index = model.trackRows.firstIndex(where: { $0.id == row.id }) {
            model.trackRows[index].title = newValue
        }
    }
}

private extension View {
    /// A hero/field row: no fill, no separator, no side inset.
    func clearRow(top: CGFloat, bottom: CGFloat) -> some View {
        listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(
                top: top,
                leading: Theme.Immersive.recordRowSideInset,
                bottom: bottom,
                trailing: Theme.Immersive.recordRowSideInset
            ))
    }

    /// A row of a panel card.
    func panelRow(_ edge: PanelEdge) -> some View {
        listRowBackground(PanelRowBackground(edge: edge))
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(
                top: Theme.Spacing.rowGap,
                leading: Theme.Immersive.panelRowInset,
                bottom: Theme.Spacing.rowGap,
                trailing: Theme.Immersive.panelRowInset
            ))
    }
}

/// The sleeve's VoiceOver reading in view mode: "Cover", an image. In edit mode the sleeve's own
/// label ("Add cover art" or "Change cover art") and button trait stand.
private struct ViewModeCoverAccessibility: ViewModifier {
    let isEditing: Bool

    func body(content: Content) -> some View {
        if isEditing {
            content
        } else {
            content
                .accessibilityLabel(Copy.Release.cover)
                .accessibilityAddTraits(.isImage)
        }
    }
}

/// What the share sheet is about: the whole release (`trackId` nil) or one song.
struct ShareTarget: Identifiable {
    let id = UUID()
    let trackId: UUID?
    let subject: String
}

private extension UIColor {
    var hsbBrightness: CGFloat {
        var b: CGFloat = 0
        getHue(nil, saturation: nil, brightness: &b, alpha: nil)
        return b
    }
}
