import SwiftUI
import UniformTypeIdentifiers

/// A release's edit screen: editable title/artist/year/genre, reorderable
/// track titles, a cover replacer, save, and a two-step delete. Opened from
/// `LibraryView` via `navigationDestination(for: Release.self)`. Styled as
/// `docs/design.md`'s "Editor / release detail" (the Mobile Editor).
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
                HStack(alignment: .top, spacing: 12) {
                    CoverPicker(
                        imageData: Binding(get: { model.coverData }, set: { model.coverData = $0 }),
                        rawPick: $rawCoverPick,
                        style: .thumb
                    ) {
                        isPresentingCoverPicker = true
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        KindBadge(text: model.kind == .single ? Copy.Library.single : Copy.Library.album)
                        Text(model.title)
                            .font(Theme.Font.pageTitle)
                            .foregroundStyle(Theme.primaryText)
                            .lineLimit(2)
                        Text(model.artist)
                            .font(Theme.Font.rowSubtitle)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 2, bottom: 0, trailing: 2))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

                metadataHeader
                    .listRowInsets(EdgeInsets(top: 12, leading: 2, bottom: 4, trailing: 2))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)

                Field(Copy.Import.fieldTitle, text: Binding(get: { model.title }, set: { model.title = $0 }))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: 2, bottom: Theme.Spacing.rowGap, trailing: 2))
                Field(Copy.Import.fieldArtist, text: Binding(get: { model.artist }, set: { model.artist = $0 }))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: 2, bottom: Theme.Spacing.rowGap, trailing: 2))
                HStack(spacing: 12) {
                    Field(Copy.Import.fieldYear, text: Binding(get: { model.year }, set: { model.year = $0 }), keyboardType: .numberPad)
                    Field(Copy.Import.fieldGenre, text: Binding(get: { model.genre }, set: { model.genre = $0 }))
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: 2, bottom: Theme.Spacing.rowGap, trailing: 2))
            }

            Section {
                tracksHeader(model.trackRows.count)
                    .listRowInsets(EdgeInsets(top: 12, leading: 2, bottom: model.trackRows.count >= 2 ? 2 : 4, trailing: 2))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)

                if model.trackRows.count >= 2 {
                    Text(Copy.Detail.reorderHint)
                        .font(Theme.Font.dropZoneHint)
                        .foregroundStyle(Theme.textDim)
                        .listRowInsets(EdgeInsets(top: 0, leading: 2, bottom: 4, trailing: 2))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                ForEach(Array(model.trackRows.enumerated()), id: \.element.id) { index, row in
                    // A single's only track takes its title from the Title
                    // field above, so its row shows that live value rather
                    // than the (only saved-on-send) track row title.
                    FileRow(
                        index: index + 1,
                        title: model.kind == .single ? model.title : row.title,
                        isEditable: model.kind == .album,
                        isCompact: true,
                        onTitleChange: { newValue in setTitle(newValue, for: row, in: model) }
                    )
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: Theme.Spacing.rowGap, leading: 2, bottom: Theme.Spacing.rowGap, trailing: 2))
                }
                .onMove(perform: model.moveTracks)
            }

            if model.kind == .album {
                Section {
                    DisclosureGroup(Copy.Detail.makeItAPlaylist) {
                        PlaylistGuide(albumTitle: model.title)
                    }
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.primaryText)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }

            if model.statusMessage != nil || model.errorMessage != nil {
                Section {
                    if let statusMessage = model.statusMessage {
                        Text(statusMessage)
                            .font(Theme.Font.rowSubtitle)
                            .foregroundStyle(Theme.accent)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                    if let errorMessage = model.errorMessage {
                        Text(errorMessage)
                            .font(Theme.Font.rowSubtitle)
                            .foregroundStyle(Theme.danger)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }
            }

            Section {
                Button {
                    isPresentingDeleteConfirm = true
                } label: {
                    Text(Copy.Detail.delete)
                }
                .buttonStyle(TextButtonStyle(color: Theme.danger))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
        }
        // `.plain` (rather than the default `.insetGrouped`) so sections
        // don't get a rounded-corner card clip — every row's own background
        // is drawn by hand via `.cardContainer()`/`FileRow`, and the system
        // corner clip was cutting into the first row's leading glyph.
        .listStyle(.plain)
        .listSectionSpacing(.custom(Theme.Spacing.editorSectionGap))
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(model.title)
        .navigationBarTitleDisplayMode(.inline)
        .stickyFooter {
            Button {
                Task { await model.save() }
            } label: {
                if model.isSaving {
                    Text(Copy.Detail.saving)
                } else {
                    Text(Copy.Detail.saveChanges)
                }
            }
            .buttonStyle(PrimaryPillButtonStyle())
            .disabled(!model.canSave)
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

    private var metadataHeader: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(Copy.Detail.detailsEyebrow).eyebrow()
            Spacer()
            Text(Copy.Detail.tapToEdit)
                .font(Theme.Font.meta)
                .foregroundStyle(Theme.secondaryText)
        }
    }

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

    /// Sets a track row's title by its stable `Track.id` (not index), so it
    /// stays correct while `.onMove` changes positions.
    private func setTitle(_ newValue: String, for row: ReleaseDetailViewModel.TrackRow, in model: ReleaseDetailViewModel) {
        if let index = model.trackRows.firstIndex(where: { $0.id == row.id }) {
            model.trackRows[index].title = newValue
        }
    }
}
