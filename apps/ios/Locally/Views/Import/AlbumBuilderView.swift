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
                Button {
                    activePicker = .files
                    isPickerPresented = true
                } label: {
                    Label(Copy.Import.chooseFiles, systemImage: "waveform")
                }
                .buttonStyle(.bordered)
                .tint(Theme.accent)
            }
            .listRowBackground(Theme.panel)

            Section("Tracks") {
                if model.rows.isEmpty {
                    Text(Copy.Import.noTracksYet)
                        .foregroundStyle(Theme.secondaryText)
                } else {
                    ForEach(Array(model.rows.enumerated()), id: \.element.id) { index, row in
                        HStack(spacing: 10) {
                            Text("\(index + 1)")
                                .font(.caption)
                                .foregroundStyle(Theme.secondaryText)
                                .frame(width: 24, alignment: .trailing)
                            TextField(Copy.Import.track, text: titleBinding(for: row, in: model))
                                .foregroundStyle(Theme.primaryText)
                        }
                    }
                    .onMove(perform: model.moveRows)
                    .onDelete(perform: model.removeRows)
                }
            }
            .listRowBackground(Theme.panel)

            Section {
                Field(Copy.Import.fieldAlbumTitle, text: Binding(get: { model.albumTitle }, set: { model.albumTitle = $0 }))
                Field(Copy.Import.fieldArtist, text: Binding(get: { model.artist }, set: { model.artist = $0 }))
                Field(Copy.Import.fieldYear, text: Binding(get: { model.year }, set: { model.year = $0 }), keyboardType: .numberPad)
                Field(Copy.Import.fieldGenre, text: Binding(get: { model.genre }, set: { model.genre = $0 }))
            }
            .listRowBackground(Theme.panel)

            Section {
                CoverPicker(
                    imageData: Binding(get: { model.coverData }, set: { model.coverData = $0 }),
                    rawPick: $rawCoverPick
                ) {
                    activePicker = .cover
                    isPickerPresented = true
                }
                Text(Copy.Import.albumCoverPrompt)
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
                Text(Copy.Import.albumExplainer)
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
            }
            .listRowBackground(Theme.panel)

            Section {
                if let errorMessage = model.errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Button {
                    Task { await model.send() }
                } label: {
                    if model.isSending {
                        VStack(spacing: 4) {
                            ProgressView().tint(.white)
                            Text(Copy.Import.taggingProgress(done: model.progressDone, total: model.progressTotal))
                                .font(.caption2)
                        }
                        .frame(maxWidth: .infinity)
                    } else {
                        Text(Copy.Import.send)
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(!model.canSend)
            }
            .listRowBackground(Theme.panel)
        }
        .scrollContentBackground(.hidden)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                EditButton()
            }
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

    /// A title binding by row id (not index), so it stays correct while
    /// `.onMove`/`.onDelete` change positions.
    private func titleBinding(for row: AlbumBuilderViewModel.TrackRow, in model: AlbumBuilderViewModel) -> Binding<String> {
        Binding(
            get: { model.rows.first(where: { $0.id == row.id })?.title ?? row.title },
            set: { newValue in
                if let index = model.rows.firstIndex(where: { $0.id == row.id }) {
                    model.rows[index].title = newValue
                }
            }
        )
    }
}
