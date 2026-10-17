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
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let release: Release
    /// DEBUG screenshots open the page already in edit mode.
    var startsEditing = false

    @State private var model: ReleaseDetailViewModel?
    @State private var isPresentingFileImporter = false
    @State private var isPresentingCoverSource = false
    @State private var isPresentingPhotos = false
    @State private var recentCovers: [RecentCover] = []
    /// The choice made in the cover sheet, acted on once the sheet has closed (Photos and
    /// Files cannot present while it is still on screen).
    @State private var pendingCoverChoice: CoverChoiceSheet.Choice?
    @State private var isPresentingDeleteConfirm = false
    @State private var isPresentingReview = false
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
                let made = ReleaseDetailViewModel(release: release, coordinator: container.coordinator, coverStore: container.coverStore, syncApi: container.syncApi, isSignedIn: { container.syncAccount.deviceToken != nil })
                coverImage = made.coverData.flatMap(UIImage.init(data:))
                coverImageData = made.coverData
                if startsEditing { made.beginEditing() }
                model = made
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
                    trackRows(model)
                    if model.hasPlays { playsFootnote.panelRow(.middle) }
                    if model.isAdopted { adoptedNote.panelRow(.middle) }
                    if isAlbum { playlistGuide(model).panelRow(.middle) }
                    messages(model)
                    if model.isEditing {
                        deleteButton.panelRow(.bottom).transition(.opacity)
                    }
                }
                .panelListSection()
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.custom(Theme.Spacing.editorSectionGap))
            .environment(\.defaultMinListRowHeight, 0)
            .scrollContentBackground(.hidden)
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button(Copy.Release.edit) { model.beginEditing() }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // Mode changes are instant; only the dock fades (0.25 s, signature easing; none under Reduce Motion).
            ZStack {
                if model.isEditing {
                    ReleaseDock(model: model, glowColors: glowColors) {
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
        .sheet(isPresented: $isPresentingReview) {
            ReleaseReviewSheet(model: model, glowColors: glowColors) { isPresentingReview = false }
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
                style: .thumb
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
        YearGenreRow(year: Binding(get: { model.year }, set: { model.year = $0 }), genre: Binding(get: { model.genre }, set: { model.genre = $0 }), isEditable: model.isEditing)
            .clearRow(top: 0, bottom: 0)
    }

    // MARK: View mode (#296)

    /// The Mac's details: meta line, title, artist, "Year 2025   Genre Rap".
    private func details(_ model: ReleaseDetailViewModel) -> some View {
        ReleaseDetailsView(kind: model.kind, trackCount: model.trackRows.count, title: model.title, artist: model.artist, year: model.year, genre: model.genre)
            .clearRow(top: 0, bottom: 0)
    }

    /// The tracks with no card: a "Tracks" heading, the quiet header row, then a row per track with a
    /// hairline between rows. Playlists aren't a column on the phone.
    @ViewBuilder
    private func viewTracks(_ model: ReleaseDetailViewModel) -> some View {
        let headings = model.discHeadings
        let last = model.trackRows.count - 1
        Text(Copy.Import.tracks)
            .font(.system(size: 17, weight: .bold))
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
                artist: model.artist.isEmpty ? Copy.Detail.unknownArtist : model.artist,
                plays: model.playTotal(for: row),
                time: TrackLength.format(seconds),
                timeSpoken: TrackLength.spoken(seconds)
            )
            .overlay(alignment: .bottom) {
                if index != last { Rectangle().fill(Theme.Track.separatorTint).frame(height: 1) }
            }
            .clearRow(top: 0, bottom: 0)
        }
        if model.hasPlays { playsFootnote.clearRow(top: 12, bottom: 0) }
        if model.isAdopted { adoptedNote.clearRow(top: 8, bottom: 0) }
        if model.kind == .album { playlistGuide(model).clearRow(top: 8, bottom: 0) }
        viewMessages(model)
    }

    @ViewBuilder
    private func viewMessages(_ model: ReleaseDetailViewModel) -> some View {
        if let statusMessage = model.statusMessage {
            Text(statusMessage)
                .font(Theme.Font.meta)
                .foregroundStyle(Theme.secondaryText)
                .clearRow(top: 8, bottom: 0)
        }
        if let errorMessage = model.errorMessage {
            Text(errorMessage)
                .font(Theme.Font.rowSubtitle)
                .foregroundStyle(Theme.danger)
                .clearRow(top: 8, bottom: 0)
        }
    }

    // MARK: Panel rows

    private func tracksHeader(_ count: Int) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(Copy.Import.tracks)
                .font(Theme.Font.sectionTitle)
                .foregroundStyle(Theme.primaryText)
            Spacer()
            Text(Copy.Detail.fileCount(count))
                .font(Theme.Font.meta)
                .foregroundStyle(Theme.secondaryText)
        }
    }

    private var reorderHint: some View {
        Text(Copy.Detail.reorderHint)
            .font(Theme.Font.dropZoneHint)
            .foregroundStyle(Theme.textDim)
            .accessibilityIdentifier("reorder-hint")
    }

    // Long-press drag via `.onMove` without an Edit-mode toolbar button (iOS 16+).
    // Singles and one-track albums leave move disabled so the gesture doesn't
    // fight the title field.
    private func trackRows(_ model: ReleaseDetailViewModel) -> some View {
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
        }
        .onMove(perform: model.isEditing && model.trackRows.count >= 2 ? model.moveTracks : nil)
    }

    /// One line under the tracks saying where the play totals come from.
    private var playsFootnote: some View {
        Text(Copy.Detail.playsAcrossDevices)
            .font(Theme.Font.dropZoneHint)
            .foregroundStyle(Theme.textDim)
    }

    /// Says where an adopted release's files are: they never come to this phone.
    private var adoptedNote: some View {
        Text(Copy.Detail.adoptedNote)
            .font(Theme.Font.dropZoneHint)
            .foregroundStyle(Theme.textDim)
    }

    private func playlistGuide(_ model: ReleaseDetailViewModel) -> some View {
        DisclosureGroup(Copy.Detail.makeItAPlaylist) {
            PlaylistGuide(albumTitle: model.title)
        }
        .font(Theme.Font.body)
        .foregroundStyle(Theme.primaryText)
        .frame(minHeight: Theme.Immersive.panelActionMinHeight)
    }

    /// The status line (quiet: it carries the Spotify rescan guidance) and the error line.
    @ViewBuilder
    private func messages(_ model: ReleaseDetailViewModel) -> some View {
        if let statusMessage = model.statusMessage {
            Text(statusMessage)
                .font(Theme.Font.meta)
                .foregroundStyle(Theme.secondaryText)
                .panelRow(.middle)
        }
        if let errorMessage = model.errorMessage {
            Text(errorMessage)
                .font(Theme.Font.rowSubtitle)
                .foregroundStyle(Theme.danger)
                .panelRow(.middle)
        }
    }

    private var deleteButton: some View {
        Button {
            isPresentingDeleteConfirm = true
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
