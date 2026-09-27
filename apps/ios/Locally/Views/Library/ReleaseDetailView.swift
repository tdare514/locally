import SwiftUI
import UniformTypeIdentifiers

/// A release's edit screen: editable title/artist/year/genre, reorderable
/// track titles, a cover replacer, save, and a two-step delete. Opened from
/// `LibraryView` via `navigationDestination(for: Release.self)`.
struct ReleaseDetailView: View {
    @Environment(\.appContainer) private var container
    @Environment(\.dismiss) private var dismiss

    let release: Release

    @State private var model: ReleaseDetailViewModel?
    @State private var isPresentingCoverPicker = false
    @State private var isPresentingDeleteConfirm = false
    /// Raw bytes from the Files cover pick, handed to `CoverPicker` to
    /// crop; see `CoverPicker.rawPick`.
    @State private var rawCoverPick: Data?

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
                model = ReleaseDetailViewModel(release: release, coordinator: container.coordinator, coverStore: container.coverStore)
            }
        }
    }

    @ViewBuilder
    private func content(_ model: ReleaseDetailViewModel) -> some View {
        List {
            Section {
                Field(Copy.Import.fieldTitle, text: Binding(get: { model.title }, set: { model.title = $0 }))
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
                    isPresentingCoverPicker = true
                }
            }
            .listRowBackground(Theme.panel)

            // A single's only track takes its title from the Title field above.
            if model.kind == .album {
                Section("Tracks") {
                    ForEach(Array(model.trackRows.enumerated()), id: \.element.id) { index, row in
                        HStack(spacing: 10) {
                            Text("\(index + 1)")
                                .font(.caption)
                                .foregroundStyle(Theme.secondaryText)
                                .frame(width: 24, alignment: .trailing)
                            TextField(Copy.Import.track, text: titleBinding(for: row, in: model))
                                .foregroundStyle(Theme.primaryText)
                        }
                    }
                    .onMove(perform: model.moveTracks)
                }
                .listRowBackground(Theme.panel)
            }

            if model.kind == .album {
                Section {
                    DisclosureGroup(Copy.Detail.makeItAPlaylist) {
                        Text(Copy.Import.doneAlbum)
                            .font(.footnote)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    .foregroundStyle(Theme.primaryText)
                }
                .listRowBackground(Theme.panel)
            }

            Section {
                if let statusMessage = model.statusMessage {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(Theme.accent)
                }
                if let errorMessage = model.errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Button {
                    Task { await model.save() }
                } label: {
                    if model.isSaving {
                        Text(Copy.Detail.saving)
                    } else {
                        Text(Copy.Detail.saveChanges)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(!model.canSave)
            }
            .listRowBackground(Theme.panel)

            Section {
                Button(role: .destructive) {
                    isPresentingDeleteConfirm = true
                } label: {
                    Text(Copy.Detail.delete)
                }
            }
            .listRowBackground(Theme.panel)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(model.title)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                EditButton()
            }
        }
        .fileImporter(isPresented: $isPresentingCoverPicker, allowedContentTypes: [.image]) { result in
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

    /// A title binding by track id (not index), so it stays correct while
    /// `.onMove` changes positions.
    private func titleBinding(for row: ReleaseDetailViewModel.TrackRow, in model: ReleaseDetailViewModel) -> Binding<String> {
        Binding(
            get: { model.trackRows.first(where: { $0.id == row.id })?.title ?? row.title },
            set: { newValue in
                if let index = model.trackRows.firstIndex(where: { $0.id == row.id }) {
                    model.trackRows[index].title = newValue
                }
            }
        )
    }
}
