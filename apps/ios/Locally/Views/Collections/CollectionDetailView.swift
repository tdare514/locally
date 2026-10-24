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
    private static let guideID = "playlist-guide"
    private static let endID = "list-end"

    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.playback) private var playback
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
        .onChange(of: playback?.wontPlayTrackIDs ?? []) { old, new in announceNewlyMissing(old: old, new: new) }
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
        let rows = model.rows(of: collection)
        let visible = model.visibleItems(of: collection)
        return ScrollViewReader { proxy in
        List {
            header(collection, rows: rows)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            if let editFailure {
                editFailureRow(editFailure)
            }
            if editMode.isEditing {
                editSection(collection, visible: visible)
            } else {
                queueSection(collection, rows: rows)
                if !rows.isEmpty { playlistGuide(collection) }
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

    // MARK: Playing

    private var context: QueueContext { QueueContext(kind: .collection, id: id) }
    private var playQueue: [(releaseID: UUID, trackID: UUID)] {
        model.collection(id).map { model.playQueue(of: $0) } ?? []
    }
    /// The player's queue came from this collection.
    private var isPlayingThis: Bool { playback?.queue?.context == context }
    private var isPlaying: Bool { playback?.isPlaying ?? false }

    /// Play starts the queue; Pause / Play on the collection that is already playing.
    private func togglePlay() {
        if isPlayingThis { playback?.togglePlayPause() } else { start(at: 0) }
    }

    /// Plays this collection from the `position`th playable track.
    private func start(at position: Int) {
        let queue = playQueue
        let releases = Set(queue.map(\.releaseID)).compactMap { model.releases[$0] }
        playback?.play(items: queue.map { QueueItem(releaseId: $0.releaseID, trackId: $0.trackID) }, releases: releases, context: context, startingAt: position)
    }

    /// A row is playing only when the queue came from here and its index is that row's place among the playable
    /// ones (the same track may be in the collection twice).
    private func isNowPlaying(playablePosition: Int?, _ row: CollectionQueue.Row) -> Bool {
        guard let playablePosition, let queue = playback?.queue, queue.context == context, queue.index == playablePosition,
              queue.items.indices.contains(queue.index) else { return false }
        return queue.items[queue.index] == QueueItem(releaseId: row.releaseID, trackId: row.trackID)
    }

    /// Announces a track of this collection that has just failed to play, once.
    private func announceNewlyMissing(old: Set<UUID>, new: Set<UUID>) {
        let held = Set(model.collection(id).map { model.rows(of: $0) }?.filter(\.isHeld).map(\.trackID) ?? [])
        guard !new.subtracting(old).isDisjoint(with: held) else { return }
        AccessibilityNotification.Announcement("\(Copy.Collections.couldntPlay). \(Copy.Collections.tryAgain)").post()
    }

    private func tapRow(_ row: CollectionQueue.Row, playablePosition: Int, nowPlaying: Bool) {
        if nowPlaying { playback?.togglePlayPause() } else { start(at: playablePosition) }
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
                if !editMode.isEditing {
                    Button(action: togglePlay) {
                        Label(CollectionPlayState.pillLabel(isCurrentQueue: isPlayingThis, isPlaying: isPlaying),
                              systemImage: isPlayingThis && isPlaying ? "pause.fill" : "play.fill")
                    }
                    .accessibilityLabel(CollectionPlayState.pillLabel(isCurrentQueue: isPlayingThis, isPlaying: isPlaying))
                    .buttonStyle(CollectionPillButtonStyle())
                    .disabled(playQueue.isEmpty)
                    .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 8)
    }

    // MARK: View mode

    /// "Make it a playlist" (#353), the release page's disclosure over this collection's tracks that this phone holds.
    private func playlistGuide(_ collection: MusicCollection) -> some View {
        let guide = CollectionQueue.playlistGuide(collection.items, releases: model.releases)
        return DisclosureGroup(Copy.Detail.makeItAPlaylist, isExpanded: $isGuideOpen) {
            if guide.titles.isEmpty {
                Text(Copy.Collections.nothingToAdd)
                    .themeFont(.body)
                    .foregroundStyle(Theme.secondaryText)
            } else {
                PlaylistGuide(
                    albumTitle: collection.name,
                    trackTitles: guide.titles,
                    note: guide.leftOut > 0 ? Copy.Collections.leftOutOfGuide(guide.leftOut) : nil
                )
            }
        }
        .themeFont(.body)
        .foregroundStyle(Theme.primaryText)
        .frame(minHeight: Theme.Immersive.panelActionMinHeight)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .id(Self.guideID)
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
                    // The row's place among the playable ones: where Play starts from.
                    let playablePosition: Int? = row.isHeld ? rows[..<index].filter(\.isHeld).count : nil
                    queueRow(row, number: index + 1, playablePosition: playablePosition)
                        .listRowBackground(Theme.Immersive.panelFill)
                        .listRowSeparatorTint(Theme.Track.separatorTint)
                }
            } header: {
                stickyHeader(Copy.Collections.queueHeading)
            }
        }
    }

    @ViewBuilder
    private func queueRow(_ row: CollectionQueue.Row, number: Int, playablePosition: Int?) -> some View {
        let nowPlaying = isNowPlaying(playablePosition: playablePosition, row)
        if let playablePosition, playback?.wontPlay(row.trackID) == true {
            VStack(alignment: .leading, spacing: 8) {
                queueRowContent(row, number: number, nowPlaying: false, wontPlay: true)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(row.title), \(row.artist), \(Copy.Collections.couldntPlay)")
                Button(Copy.Collections.tryAgain) { start(at: playablePosition) }
                    .buttonStyle(CollectionPillButtonStyle())
                    // Under the title: past the number column and its gap.
                    .padding(.leading, numberColumnWidth + 12)
            }
        } else if let playablePosition {
            Button { tapRow(row, playablePosition: playablePosition, nowPlaying: nowPlaying) } label: {
                queueRowContent(row, number: number, nowPlaying: nowPlaying)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CollectionPlayState.rowLabel([row.title, row.artist, TrackLength.spoken(row.durationSec)].compactMap { $0 }.joined(separator: ", "), isCurrentRow: nowPlaying, isPlaying: isPlaying))
            .accessibilityValue(CollectionPlayState.rowValue(isCurrentRow: nowPlaying, isPlaying: isPlaying))
            .accessibilityAddTraits(nowPlaying ? .isSelected : [])
        } else {
            queueRowContent(row, number: number, nowPlaying: false)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(row.title), \(row.artist), \(Copy.Collections.onYourMac)")
                .accessibilityValue(TrackLength.spoken(row.durationSec) ?? "")
        }
    }

    /// The queue row's number column (minWidth 24) plus its 12 gap: where the title starts.
    /// The number column grows with the text, and Try again's inset (past the column and its 12 pt gap) with it.
    @ScaledMetric(relativeTo: .footnote) private var numberColumnWidth: CGFloat = 24

    private func queueRowContent(_ row: CollectionQueue.Row, number: Int, nowPlaying: Bool, wontPlay: Bool = false) -> some View {
        HStack(spacing: 12) {
            Group {
                if nowPlaying {
                    Image(systemName: isPlaying ? "speaker.wave.2.fill" : "pause.fill")
                        .foregroundStyle(Theme.accent)
                } else {
                    Text("\(number)")
                        .monospacedDigit()
                        .foregroundStyle(Theme.textDim)
                }
            }
            .themeFont(.meta)
            .frame(minWidth: numberColumnWidth, alignment: .trailing)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .themeFont(.rowTitle)
                    .foregroundStyle(nowPlaying ? Theme.accent : Theme.primaryText)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                Text(row.isHeld ? row.artist : Copy.Collections.onYourMac)
                    .themeFont(.rowSubtitle)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                if wontPlay {
                    Text(Copy.Collections.couldntPlay)
                        .themeFont(.rowSubtitle)
                        .foregroundStyle(Theme.danger)
                }
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
        .frame(minHeight: 44)
        .contentShape(.rect)
        .opacity(row.isHeld ? 1 : 0.5)
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
