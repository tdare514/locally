import SwiftUI

/// One collection (#350): its queue in play order, and an edit mode for the order, the name and the collection
/// itself. Play is not here yet: the player takes a collection queue once #344 lands, and the queue it will play is
/// `CollectionsModel.playQueue(of:)`.
struct CollectionDetailView: View {
    let model: CollectionsModel
    let id: UUID
    /// "Add tracks": leaves for the Library, where any release or track row can be added.
    var onAddTracks: () -> Void
    @State private var editMode: EditMode

    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var isRenaming = false
    @State private var renameText = ""
    @State private var isConfirmingDelete = false

    /// `startsEditing` opens the screen in edit mode (the debug gallery's screenshots).
    init(model: CollectionsModel, id: UUID, startsEditing: Bool = false, onAddTracks: @escaping () -> Void) {
        self.model = model
        self.id = id
        self.onAddTracks = onAddTracks
        _editMode = State(initialValue: startsEditing ? .active : .inactive)
    }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if let collection = model.collection(id) {
                content(collection)
            } else {
                Color.clear
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            if model.collection(id) != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(editMode.isEditing ? Copy.Collections.done : Copy.Collections.edit) {
                        withAnimation { editMode = editMode.isEditing ? .inactive : .active }
                    }
                }
            }
        }
        .environment(\.editMode, $editMode)
        .task { model.reload() }
        .nameAlert(Copy.Collections.renameTitle, action: Copy.Collections.save, isPresented: $isRenaming, text: $renameText) { name in
            model.rename(id, to: name)
        }
        .confirmationDialog(Copy.Collections.deleteTitle, isPresented: $isConfirmingDelete, titleVisibility: .visible) {
            Button(Copy.Collections.delete, role: .destructive) {
                model.delete(id)
                dismiss()
            }
            Button(Copy.Collections.cancel, role: .cancel) {}
        } message: {
            Text(Copy.Collections.deleteMessage)
        }
    }

    private func content(_ collection: MusicCollection) -> some View {
        let rows = model.rows(of: collection)
        let visible = model.visibleItems(of: collection)
        return List {
            header(collection, rows: rows)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            if editMode.isEditing {
                editSection(collection, visible: visible)
            } else {
                queueSection(collection, rows: rows)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 44)
    }

    private func header(_ collection: MusicCollection, rows: [CollectionQueue.Row]) -> some View {
        HStack(spacing: 16) {
            CollectionCoverView(releaseIDs: model.coverReleaseIDs(of: collection), side: 88)
            VStack(alignment: .leading, spacing: 4) {
                Text(collection.name)
                    .themeFont(.pageTitle)
                    .foregroundStyle(Theme.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Text(Copy.Collections.trackCount(rows.count))
                    .themeFont(.meta)
                    .foregroundStyle(Theme.secondaryText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 8)
    }

    // MARK: View mode

    @ViewBuilder
    private func queueSection(_ collection: MusicCollection, rows: [CollectionQueue.Row]) -> some View {
        if rows.isEmpty {
            VStack(spacing: 16) {
                Text(Copy.Collections.emptyCollection)
                    .themeFont(.body)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                Button(action: onAddTracks) { Text(Copy.Collections.addTracks) }
                    .buttonStyle(CollectionPillButtonStyle())
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 24)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        } else {
            if !rows.contains(where: \.isHeld) {
                Text(Copy.Collections.nonePlayable)
                    .themeFont(.body)
                    .foregroundStyle(Theme.secondaryText)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            Section {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    queueRow(row, number: index + 1)
                        .listRowBackground(Theme.Immersive.panelFill)
                        .listRowSeparatorTint(Theme.Track.separatorTint)
                }
            } header: {
                Text(Copy.Collections.queueHeading)
                    .themeFont(.sectionTitle)
                    .foregroundStyle(Theme.primaryText)
                    .textCase(nil)
            }
        }
    }

    private func queueRow(_ row: CollectionQueue.Row, number: Int) -> some View {
        HStack(spacing: 12) {
            Text("\(number)")
                .themeFont(.meta)
                .foregroundStyle(Theme.textDim)
                .monospacedDigit()
                .frame(minWidth: 24, alignment: .trailing)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .themeFont(.rowTitle)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                Text(row.isHeld ? row.artist : Copy.Collections.onYourMac)
                    .themeFont(.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let length = TrackLength.format(row.durationSec) {
                Text(length)
                    .themeFont(.meta)
                    .foregroundStyle(Theme.secondaryText)
                    .monospacedDigit()
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 4)
        .opacity(row.isHeld ? 1 : 0.5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.isHeld ? "\(row.title), \(row.artist)" : "\(row.title), \(row.artist), \(Copy.Collections.onYourMac)")
        .accessibilityValue(TrackLength.spoken(row.durationSec) ?? "")
    }

    // MARK: Edit mode

    @ViewBuilder
    private func editSection(_ collection: MusicCollection, visible: [Int]) -> some View {
        Section {
            // Identified by the item itself (a collection holds each at most once), so a move animates the row.
            ForEach(Array(visible.map { collection.items[$0] }.enumerated()), id: \.element) { position, item in
                editRow(item)
                    .listRowBackground(Theme.Immersive.panelFill)
                    .accessibilityAction(named: Copy.Collections.moveUp) { model.move(id, position: position, by: -1) }
                    .accessibilityAction(named: Copy.Collections.moveDown) { model.move(id, position: position, by: 1) }
            }
            .onMove { source, destination in model.move(id, from: source, to: destination) }
            .onDelete { offsets in
                for position in offsets.sorted(by: >) { model.remove(id, position: position) }
            }
        } header: {
            Text(Copy.Collections.itemsHeading)
                .themeFont(.sectionTitle)
                .foregroundStyle(Theme.primaryText)
                .textCase(nil)
        }
        Section {
            Button {
                renameText = collection.name
                isRenaming = true
            } label: {
                Text(Copy.Collections.rename)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .listRowBackground(Theme.Immersive.panelFill)
            Button(role: .destructive) {
                isConfirmingDelete = true
            } label: {
                Text(Copy.Collections.delete)
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .listRowBackground(Theme.Immersive.panelFill)
        }
    }

    @ViewBuilder
    private func editRow(_ item: CollectionItem) -> some View {
        let label = itemLabel(item)
        VStack(alignment: .leading, spacing: 2) {
            Text(label.title)
                .themeFont(.rowTitle)
                .foregroundStyle(Theme.primaryText)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            Text(label.subtitle)
                .themeFont(.rowSubtitle)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label.title), \(label.subtitle)")
    }

    private func itemLabel(_ item: CollectionItem) -> (title: String, subtitle: String) {
        switch item {
        case .release(let releaseId):
            guard let release = model.releases[releaseId] else { return ("", "") }
            return (release.title, Copy.Collections.releaseItem(tracks: release.tracks.count))
        case .track(let releaseId, let trackId):
            guard let release = model.releases[releaseId], let track = release.tracks.first(where: { $0.id == trackId }) else { return ("", "") }
            return (track.title, "\(Copy.Collections.trackItem), \(release.title)")
        case .unknown:
            return ("", "")
        }
    }
}
