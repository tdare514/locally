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

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            if let model, model.completedRelease != nil {
                DoneView(kind: .album, trackTitles: model.orderedTrackTitles, albumTitle: model.albumTitle) {
                    model.reset()
                }
            } else if let model {
                form(model)
            }
        }
        .task {
            if model == nil, let container {
                model = AlbumBuilderViewModel(importer: container.importer, coordinator: container.coordinator, inbox: container.inbox)
            }
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
                HStack(alignment: .top, spacing: 16) {
                    CoverPicker(
                        imageData: Binding(get: { model.coverData }, set: { model.coverData = $0 }),
                        rawPick: $rawCoverPick,
                        style: .compact
                    ) {
                        activePicker = .cover
                        isPickerPresented = true
                    }
                    VStack(alignment: .leading, spacing: Theme.Spacing.fieldGap) {
                        Field(Copy.Import.fieldAlbumTitle, text: Binding(get: { model.albumTitle }, set: { model.albumTitle = $0 }))
                        Field(Copy.Import.fieldArtist, text: Binding(get: { model.artist }, set: { model.artist = $0 }))
                    }
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
                HStack(spacing: 12) {
                    Field(Copy.Import.fieldYear, text: Binding(get: { model.year }, set: { model.year = $0 }), keyboardType: .numberPad)
                    Field(Copy.Import.fieldGenre, text: Binding(get: { model.genre }, set: { model.genre = $0 }))
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
                if model.rows.isEmpty {
                    Text(Copy.Import.noTracksYet)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.secondaryText)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                } else {
                    ForEach(Array(model.rows.enumerated()), id: \.element.id) { index, row in
                        FileRow(
                            index: index + 1,
                            title: row.title,
                            isEditable: true,
                            onTitleChange: { newValue in setTitle(newValue, for: row, in: model) }
                        )
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: Theme.Spacing.pagePadding, bottom: Theme.Spacing.rowGap, trailing: Theme.Spacing.pagePadding))
                    }
                    .onMove(perform: model.moveRows)
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
        .background(Theme.background)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                EditButton()
            }
        }
        .stickyFooter {
            Button {
                Task { await model.send() }
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
            .disabled(!model.canSend)
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
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
        }
        .buttonStyle(.plain)
        .dropZone()
    }

    /// A title binding by row id (not index), so it stays correct while
    /// `.onMove`/`.onDelete` change positions.
    private func setTitle(_ newValue: String, for row: AlbumBuilderViewModel.TrackRow, in model: AlbumBuilderViewModel) {
        if let index = model.rows.firstIndex(where: { $0.id == row.id }) {
            model.rows[index].title = newValue
        }
    }
}
