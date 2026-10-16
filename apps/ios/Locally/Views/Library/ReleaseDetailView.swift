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

    let release: Release

    @State private var model: ReleaseDetailViewModel?
    @State private var isPresentingFileImporter = false
    @State private var isPresentingCoverSource = false
    @State private var isPresentingPhotos = false
    @State private var isPresentingDeleteConfirm = false
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
                model = made
            }
            await model?.loadPlays()
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
                    fields(model)
                    ClearSectionEnd()
                }
                .recordListSection()

                Section {
                    tracksHeader(model.trackRows.count).panelRow(.top)
                    if model.trackRows.count >= 2 { reorderHint.panelRow(.middle) }
                    trackRows(model)
                    if model.hasPlays { playsFootnote.panelRow(.middle) }
                    if isAlbum { playlistGuide(model).panelRow(.middle) }
                    messages(model)
                    deleteButton.panelRow(.bottom)
                }
                .panelListSection()
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.custom(Theme.Spacing.editorSectionGap))
            .environment(\.defaultMinListRowHeight, 0)
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ReleaseDock(model: model, glowColors: Theme.coverGlowColors(coverImage == nil ? nil : palette))
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
            RecordSleeve(cover: coverImage, ceremony: model.saveCount) {
                isPresentingCoverSource = true
            }
            .confirmationDialog(
                coverImage == nil ? Copy.Immersive.addCoverArt : Copy.Immersive.changeCoverArt,
                isPresented: $isPresentingCoverSource,
                titleVisibility: .visible
            ) {
                Button(Copy.Immersive.coverFromPhotos) { isPresentingPhotos = true }
                Button(Copy.Immersive.coverFromFiles) { isPresentingFileImporter = true }
            }
            Spacer(minLength: 0)
        }
        // Room inside the row for the sleeve's shadow, which the row would otherwise clip.
        .padding(.top, Theme.Immersive.sleeveShadowRoomTop)
        .padding(.bottom, Theme.Immersive.sleeveShadowRoomBottom)
        .clearRow(top: 0, bottom: 0)
    }

    @ViewBuilder
    private func fields(_ model: ReleaseDetailViewModel) -> some View {
        InlineField(Copy.Import.fieldTitle, text: Binding(get: { model.title }, set: { model.title = $0 }), font: Theme.Font.pageTitle)
            .clearRow(top: 0, bottom: 0)
        InlineField(Copy.Import.fieldArtist, text: Binding(get: { model.artist }, set: { model.artist = $0 }), font: Theme.Font.rowSubtitle)
            .clearRow(top: 0, bottom: 0)
        HStack(spacing: Theme.Immersive.dockGap) {
            InlineField(Copy.Import.fieldYear, text: Binding(get: { model.year }, set: { model.year = $0 }))
                .keyboardType(.numberPad)
            InlineField(Copy.Import.fieldGenre, text: Binding(get: { model.genre }, set: { model.genre = $0 }))
        }
        .clearRow(top: Theme.Immersive.fieldsMetaGap, bottom: 0)
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
            TrackRow(
                number: index + 1,
                title: model.kind == .single ? model.title : row.title,
                titleBinding: model.kind == .album
                    ? Binding(get: { row.title }, set: { setTitle($0, for: row, in: model) })
                    : nil,
                plays: model.playTotal(for: row).map(Copy.Detail.playCount),
                showsGrip: model.trackRows.count >= 2
            )
            .importTrackRow(
                isFirst: index == 0 || (headings.indices.contains(index) && headings[index] != nil),
                isLast: index == model.trackRows.count - 1 || (headings.indices.contains(index + 1) && headings[index + 1] != nil)
            )
        }
        .onMove(perform: model.trackRows.count >= 2 ? model.moveTracks : nil)
    }

    /// One line under the tracks saying where the play totals come from.
    private var playsFootnote: some View {
        Text(Copy.Detail.playsAcrossDevices)
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
