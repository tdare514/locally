import SwiftUI

/// Playing a collection from its page or from the record player (#350, #352): what the Play pill, a queue row and the
/// player's labels read and do, in one place so both screens agree. A plain value over the model and the player.
@MainActor
struct CollectionPlayControl {
    let model: CollectionsModel
    let id: UUID
    let playback: PlaybackService?

    var context: QueueContext { QueueContext(kind: .collection, id: id) }
    var playQueue: [(releaseID: UUID, trackID: UUID)] { model.collection(id).map { model.playQueue(of: $0) } ?? [] }
    /// The player's queue came from this collection.
    var isPlayingThis: Bool { playback?.queue?.context == context }
    var isPlaying: Bool { playback?.isPlaying ?? false }
    /// This collection is the one playing right now (not paused).
    var isPlayingNow: Bool { isPlayingThis && isPlaying }

    /// Play starts the queue; Pause / Play on the collection that is already playing.
    func togglePlay() {
        if isPlayingThis { playback?.togglePlayPause() } else { start(at: 0) }
    }

    /// Plays this collection from the `position`th playable track.
    func start(at position: Int) {
        let queue = playQueue
        let releases = Set(queue.map(\.releaseID)).compactMap { model.releases[$0] }
        playback?.play(items: queue.map { QueueItem(releaseId: $0.releaseID, trackId: $0.trackID) }, releases: releases, context: context, startingAt: position)
    }

    /// A row is playing only when the queue came from here and its index is that row's place among the playable
    /// ones (the same track may be in the collection twice).
    func isNowPlaying(playablePosition: Int?, _ row: CollectionQueue.Row) -> Bool {
        guard let playablePosition, let queue = playback?.queue, queue.context == context, queue.index == playablePosition,
              queue.items.indices.contains(queue.index) else { return false }
        return queue.items[queue.index] == QueueItem(releaseId: row.releaseID, trackId: row.trackID)
    }

    func tapRow(_ row: CollectionQueue.Row, playablePosition: Int, nowPlaying: Bool) {
        if nowPlaying { playback?.togglePlayPause() } else { start(at: playablePosition) }
    }

    /// Announces a track of this collection that has just failed to play, once.
    func announceNewlyMissing(old: Set<UUID>, new: Set<UUID>) {
        let held = Set(model.collection(id).map { model.rows(of: $0) }?.filter(\.isHeld).map(\.trackID) ?? [])
        guard !new.subtracting(old).isDisjoint(with: held) else { return }
        AccessibilityNotification.Announcement("\(Copy.Collections.couldntPlay). \(Copy.Collections.tryAgain)").post()
    }
}
