import SwiftUI
import UniformTypeIdentifiers

/// Phase 2's album import flow: pick several audio files at once, give each
/// an editable title (prefilled from its tags), reorder and remove them,
/// fill in the shared album fields and cover, and send the whole album to
/// Spotify's folder as one release. Shows `DoneView` on success, listing
/// the tracks in their final order.
struct AlbumBuilderView: View {
    @Environment(\.appContainer) private var container

    /// Files shared in from other apps to seed the album with, from
    /// `ImportView`'s "Make an album" action; empty for a normal visit.
    var inboxFiles: [InboxFile] = []
    /// Called once `inboxFiles` has been handed to the model, so the parent
    /// can clear its copy and not re-offer the same files if this view is
    /// recreated (e.g. after switching to Single and back).
    var onInboxFilesConsumed: () -> Void = {}

    /// Which of the two document pickers is showing. One `.fileImporter`
    /// serves both — SwiftUI presents only one per view — and the kind
    /// lives here rather than in `isPickerPresented`, since SwiftUI flips
    /// that Bool false before the completion handler runs.
    private enum Picker { case files, cover }

    @State private var model: AlbumBuilderViewModel?
    @State private var activePicker: Picker?
    @State private var isPickerPresented = false
    /// Raw bytes from the Files cover pick, handed to `CoverPicker` to
    /// crop; see `CoverPicker.rawPick`.
    @State private var rawCoverPick: Data?
    /// Backdrop colours taken from the cover; neutral until one is picked.
    @State private var palette = AmbientPalette.neutral
    /// Bumped on a successful send to play the sleeve ceremony.
    @State private var ceremony = 0
    /// True from the Send tap until the ceremony has played, so `DoneView` waits for it.
    @State private var holdingForCeremony = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            // The backdrop itself sits at the back of `ImportView`, behind the header
            // and the Single/Album switch; this screen only hands it the cover's colours.
            Color.clear

            if let model, model.completedRelease != nil, !holdingForCeremony {
                DoneView(kind: .album, trackTitles: model.orderedTrackTitles, albumTitle: model.albumTitle) {
                    model.reset()
                }
            } else if let model {
                form(model)
            }
        }
        .preference(key: ImportPaletteKey.self, value: palette)
        .task {
            if model == nil, let container {
                model = AlbumBuilderViewModel(importer: container.importer, coordinator: container.coordinator, inbox: container.inbox)
            }
        }
        .task(id: model?.coverData) {
            let data = model?.coverData
            palette = await Task.detached { ArtworkPalette.palette(forCover: data) }.value
        }
        .task(id: inboxFiles) {
            guard !inboxFiles.isEmpty, let model else { return }
            await model.addFiles(fromInbox: inboxFiles)
            onInboxFilesConsumed()
        }
    }

    @ViewBuilder
    private func form(_ model: AlbumBuilderViewModel) -> some View {
        List {
            Section {
                fileChooser
                    .listRowInsets(EdgeInsets(top: 0, leading: Theme.Spacing.pagePadding, bottom: 0, trailing: Theme.Spacing.pagePadding))
                    .listRowSeparator(.hidden)
            }
            .listRowBackground(Color.clear)

            // Cover first, compact, beside the album title and artist (the Mac
            // layout), then the rest of the metadata; the tracks follow.
            Section {
                SleeveCoverPicker(
                    imageData: Binding(get: { model.coverData }, set: { model.coverData = $0 }),
                    rawPick: $rawCoverPick,
                    ceremony: ceremony
                ) {
                    activePicker = .cover
                    isPickerPresented = true
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: Theme.Spacing.pagePadding, bottom: Theme.Spacing.rowGap, trailing: Theme.Spacing.pagePadding))
                VStack(alignment: .leading, spacing: Theme.Spacing.fieldGap) {
                    InlineField(Copy.Import.fieldAlbumTitle, text: Binding(get: { model.albumTitle }, set: { model.albumTitle = $0 }), font: Theme.Font.pageTitle)
                    InlineField(Copy.Import.fieldArtist, text: Binding(get: { model.artist }, set: { model.artist = $0 }))
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: Theme.Spacing.pagePadding, bottom: Theme.Spacing.rowGap, trailing: Theme.Spacing.pagePadding))
                Text(Copy.Import.albumExplainer)
                    .font(Theme.Font.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: Theme.Spacing.pagePadding, bottom: Theme.Spacing.rowGap, trailing: Theme.Spacing.pagePadding))
                VStack(alignment: .leading, spacing: Theme.Spacing.fieldGap) {
                    InlineField(Copy.Import.fieldYear, text: Binding(get: { model.year }, set: { model.year = $0 }))
                        .keyboardType(.numberPad)
                    InlineField(Copy.Import.fieldGenre, text: Binding(get: { model.genre }, set: { model.genre = $0 }))
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: Theme.Spacing.pagePadding, bottom: Theme.Spacing.rowGap, trailing: Theme.Spacing.pagePadding))
            }

            Section {
                // A row, not a `header:`: `.plain` lists pin section headers while
                // scrolling, and the pinned eyebrow overlapped the first track row.
                HStack {
                    Text(Copy.Import.tracks).eyebrow()
                    Spacer()
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: Theme.Spacing.pagePadding, bottom: 2, trailing: Theme.Spacing.pagePadding))
                if model.rows.count >= 2 {
                    Text(Copy.Import.reorderHint)
                        .font(Theme.Font.dropZoneHint)
                        .foregroundStyle(Theme.textDim)
                        .listRowBackground(glassRow)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 0, leading: Theme.Spacing.pagePadding, bottom: 6, trailing: Theme.Spacing.pagePadding))
                        .accessibilityIdentifier("reorder-hint")
                }
                if model.rows.isEmpty {
                    TrackListSilhouette(rows: 3)
                        .listRowBackground(glassRow)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: Theme.Spacing.pagePadding, bottom: Theme.Spacing.rowGap, trailing: Theme.Spacing.pagePadding))
                } else {
                    // Long-press drag via `.onMove` without Edit mode (iOS 16+);
                    // disabled until there are two rows so a lone track isn't
                    // lift-able. Swipe-to-delete stays available either way.
                    let headings = model.discHeadings
                    ForEach(Array(model.rows.enumerated()), id: \.element.id) { index, row in
                        if headings.indices.contains(index), let disc = headings[index] {
                            DiscHeading(number: disc)
                                .listRowBackground(glassRow)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: Theme.Spacing.pagePadding, bottom: 0, trailing: Theme.Spacing.pagePadding))
                        }
                        FileRow(
                            index: index + 1,
                            title: row.title,
                            isEditable: true,
                            onTitleChange: { newValue in setTitle(newValue, for: row, in: model) }
                        )
                        .listRowBackground(glassRow)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: Theme.Spacing.pagePadding, bottom: Theme.Spacing.rowGap, trailing: Theme.Spacing.pagePadding))
                    }
                    .onMove(perform: model.rows.count >= 2 ? model.moveRows : nil)
                    .onDelete(perform: model.removeRows)
                }
            }

            if let errorMessage = model.errorMessage {
                Section {
                    Text(errorMessage)
                        .font(Theme.Font.rowSubtitle)
                        .foregroundStyle(Theme.danger)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
            }
        }
        // `.plain` (rather than the default `.insetGrouped`) so sections
        // don't get a rounded-corner card clip — every row's own background
        // is drawn by hand via `.cardContainer()`/`FileRow`, and the system
        // corner clip was cutting into the first row's leading glyph.
        .listStyle(.plain)
        .listSectionSpacing(.custom(Theme.Spacing.sectionGap))
        .scrollContentBackground(.hidden)
        .stickyFooter {
            Button {
                Task {
                    holdingForCeremony = true
                    await model.send()
                    if model.completedRelease != nil, !reduceMotion {
                        ceremony += 1
                        try? await Task.sleep(for: .seconds(Theme.Immersive.ceremonyDuration))
                    }
                    holdingForCeremony = false
                }
            } label: {
                if model.isSending {
                    VStack(spacing: 4) {
                        ProgressView().tint(.black)
                        Text(Copy.Import.taggingProgress(done: model.progressDone, total: model.progressTotal))
                            .font(Theme.Font.rowSubtitle)
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Text(Copy.Import.send)
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(PrimaryPillButtonStyle())
            .disabled(!model.canSend || holdingForCeremony)
        }
        .fileImporter(
            isPresented: $isPickerPresented,
            allowedContentTypes: activePicker == .cover ? [.image] : [.audio],
            allowsMultipleSelection: activePicker == .files
        ) { result in
            let picker = activePicker
            activePicker = nil
            switch picker {
            case .files:
                guard case .success(let urls) = result else { return }
                Task { await model.addFiles(urls) }
            case .cover:
                guard case .success(let urls) = result, let url = urls.first else { return }
                let accessed = url.startAccessingSecurityScopedResource()
                defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                rawCoverPick = try? Data(contentsOf: url)
            case nil:
                break
            }
        }
    }

    /// A `card` drop-zone block with a dashed border and an upload icon,
    /// matching `docs/design.md`'s "Audio drop zone" component. Kept
    /// captioned "Choose files" (rather than the singular "Tap to choose a
    /// file") since this picker takes multiple files at once.
    private var fileChooser: some View {
        Button {
            activePicker = .files
            isPickerPresented = true
        } label: {
            VStack(spacing: 8) {
                Image(systemName: "icloud.and.arrow.up")
                    .font(.system(size: 26))
                    .foregroundStyle(Theme.secondaryText)
                Text(Copy.Import.chooseFiles)
                    .font(Theme.Font.dropZoneLine)
                    .foregroundStyle(Theme.primaryText)
            }
            .frame(maxWidth: .infinity, minHeight: 80)
            .padding(.horizontal, 12)
            .padding(.vertical, 24)
        }
        .buttonStyle(.plain)
        .dropZone()
    }

    /// The release page's faked-glass panel fill behind the track rows (no blur or material).
    private var glassRow: some View {
        Theme.Immersive.panelFill
    }

    /// A title binding by row id (not index), so it stays correct while
    /// `.onMove`/`.onDelete` change positions.
    private func setTitle(_ newValue: String, for row: AlbumBuilderViewModel.TrackRow, in model: AlbumBuilderViewModel) {
        if let index = model.rows.firstIndex(where: { $0.id == row.id }) {
            model.rows[index].title = newValue
        }
    }
}
