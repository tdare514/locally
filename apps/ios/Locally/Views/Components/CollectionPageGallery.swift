#if DEBUG
import SwiftUI

/// #369: the collection page as an album, over the collections gallery's seed and a player on fakes.
struct CollectionPageGallery: View {
    enum Phase { case idle, playing, paused }
    let phase: Phase
    var editing = false
    var id = CollectionsGallery.queueID
    @State private var built: (container: AppContainer, model: CollectionsModel, playback: PlaybackService)

    init(_ phase: Phase, editing: Bool = false, id: UUID = CollectionsGallery.queueID) {
        self.phase = phase
        self.editing = editing
        self.id = id
        _built = State(initialValue: CollectionsGallery.playingSetup())
    }

    var body: some View {
        IconsGallery.environment(
            NavigationStack { CollectionDetailView(model: built.model, id: id, startsEditing: editing) }
                .environment(\.playback, built.playback),
            built.container
        )
        .task {
            guard phase != .idle else { return }
            let queue = built.model.collection(CollectionsGallery.queueID).map { built.model.playQueue(of: $0) } ?? []
            let releases = Set(queue.map(\.releaseID)).compactMap { built.model.releases[$0] }
            built.playback.play(
                items: queue.map { QueueItem(releaseId: $0.releaseID, trackId: $0.trackID) }, releases: releases,
                context: QueueContext(kind: .collection, id: CollectionsGallery.queueID), startingAt: 0
            )
            if phase == .paused {
                try? await Task.sleep(for: .milliseconds(1200))
                built.playback.togglePlayPause()
            }
        }
    }
}
#endif
