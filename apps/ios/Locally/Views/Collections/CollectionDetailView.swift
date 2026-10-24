import SwiftUI

/// One collection (#350): its queue in play order, and an edit mode for the order, the name and the collection
/// itself. Play queues `CollectionsModel.playQueue(of:)` as a collection context; a row starts it from there.
struct CollectionDetailView: View {
    let model: CollectionsModel
    let id: UUID
    /// "Add tracks": leaves for the Library, where any release or track row can be added.
    var onAddTracks: () -> Void
    @State private var editMode: EditMode
    /// "Make it a playlist" (#353) starts closed.
    @State private var isGuideOpen: Bool
    private let startsGuideOpen: Bool
    private static let endID = "list-end"

    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isRenaming = false
    @State private var renameText = ""
    @State private var isConfirmingDelete = false
    /// An edit that did not save: what to say, and what Try again repeats.
    @State private var editFailure: EditFailure?

    private struct EditFailure {
        let message: String
        let retry: () -> Void
    }

    /// `startsEditing` opens the screen in edit mode, `startsGuideOpen` the playlist guide (the debug gallery's screenshots).
    init(model: CollectionsModel, id: UUID, startsEditing: Bool = false, startsGuideOpen: Bool = false, onAddTracks: @escaping () -> Void) {
        self.model = model
        self.id = id
        self.onAddTracks = onAddTracks
        _editMode = State(initialValue: startsEditing ? .active : .inactive)
        _isGuideOpen = State(initialValue: startsGuideOpen)
        self.startsGuideOpen = startsGuideOpen
    }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if let collection = model.collection(id) {
                content(collection)
            } else if let failure = model.readFailure {
                ReadFailureView(message: failure) { model.reload() }
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
                        withAnimation(reduceMotion ? nil : .default) { editMode = editMode.isEditing ? .inactive : .active }
                    }
                }
            }
        }
        .environment(\.editMode, $editMode)
        .task { model.reload() }
        .nameAlert(Copy.Collections.renameTitle, action: Copy.Collections.save, isPresented: $isRenaming, text: $renameText) { name in
            attempt(Copy.Collections.renameFailed) { try model.rename(id, to: name) }
        }
        .confirmationDialog(Copy.Collections.deleteTitle, isPresented: $isConfirmingDelete, titleVisibility: .visible) {
            Button(Copy.Collections.delete, role: .destructive) {
                deleteCollection()
            }
            Button(Copy.Collections.cancel, role: .cancel) {}
        } message: {
            Text(Copy.Collections.deleteMessage)
        }
    }

    private func content(_ collection: MusicCollection) -> some View {
        let visible = model.visibleItems(of: collection)
        return ScrollViewReader { proxy in
        List {
            CollectionQueueHeader(model: model, collection: collection, showsLength: true, isEditing: editMode.isEditing)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            if let editFailure {
                editFailureRow(editFailure)
            }
            if editMode.isEditing {
                editSection(collection, visible: visible)
            } else {
                CollectionQueueRows(model: model, collection: collection, layout: .list, isGuideOpen: $isGuideOpen, onAddTracks: onAddTracks)
                #if DEBUG
                if startsGuideOpen {
                    // Debug gallery only: the end of the list, so the open guide can be scrolled into view.
                    Color.clear.frame(height: 1).id(Self.endID).listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                #endif
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 44)
        .task {
            #if DEBUG
            // The gallery's open-guide frame: bring the guide into view (the guide starts closed otherwise).
            guard startsGuideOpen else { return }
            try? await Task.sleep(for: .milliseconds(600))
            withAnimation(nil) { proxy.scrollTo(Self.endID, anchor: .bottom) }
            #endif
        }
        }
    }

    // MARK: Edits that can fail

    /// Runs an edit; when it can't be saved the page says so inline, VoiceOver hears it, and Try again repeats it.
    private func attempt(_ message: String, _ action: @escaping () throws -> Void) {
        do {
            try action()
            editFailure = nil
        } catch {
            editFailure = EditFailure(message: message) { attempt(message, action) }
            AccessibilityNotification.Announcement("\(message) \(Copy.Collections.tryAgain)").post()
        }
    }

    /// A failed delete keeps the page open.
    private func deleteCollection() {
        attempt(Copy.Collections.deleteFailed) {
            try model.delete(id)
            dismiss()
        }
    }

    private func editFailureRow(_ failure: EditFailure) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(failure.message)
                .themeFont(.body)
                .foregroundStyle(Theme.danger)
            Button(Copy.Collections.tryAgain, action: failure.retry)
                .buttonStyle(CollectionPillButtonStyle())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
        .listRowBackground(Theme.Immersive.panelFill)
        .accessibilityElement(children: .contain)
    }

    /// A section header that sticks while the list scrolls: it carries the page's own opaque background, full width, so rows pass under it cleanly.
    private func stickyHeader(_ title: String) -> some View {
        Text(title)
            .themeFont(.sectionTitle)
            .foregroundStyle(Theme.primaryText)
            .textCase(nil)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
            .padding(.horizontal, 20)
            .background(Theme.background)
            .listRowInsets(EdgeInsets())
    }

    // MARK: Edit mode

    @ViewBuilder
    private func editSection(_ collection: MusicCollection, visible: [Int]) -> some View {
        Section {
            // Identified by the item itself (a collection holds each at most once), so a move animates the row.
            ForEach(Array(visible.map { collection.items[$0] }.enumerated()), id: \.element) { position, item in
                editRow(item)
                    .listRowBackground(Theme.Immersive.panelFill)
                    .accessibilityAction(named: Copy.Collections.moveUp) { attempt(Copy.Collections.moveFailed) { try model.move(id, position: position, by: -1) } }
                    .accessibilityAction(named: Copy.Collections.moveDown) { attempt(Copy.Collections.moveFailed) { try model.move(id, position: position, by: 1) } }
            }
            .onMove { source, destination in
                attempt(Copy.Collections.moveFailed) { try model.move(id, from: source, to: destination) }
            }
            .onDelete { offsets in
                // Highest first, and what is done is dropped, so Try again never removes a shifted neighbour.
                var remaining = offsets.sorted(by: >)
                attempt(Copy.Collections.removeFailed) {
                    while let position = remaining.first {
                        try model.remove(id, position: position)
                        remaining.removeFirst()
                    }
                }
            }
        } header: {
            stickyHeader(Copy.Collections.itemsHeading)
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
