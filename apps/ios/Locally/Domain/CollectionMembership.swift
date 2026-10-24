import Foundation

extension MusicCollection {
    /// The collections that hold a track, in the order given (#365): one with the track itself, or with its whole
    /// release, counts. An item of a kind this build does not know is skipped, never shown. A collection is listed once.
    static func containing(releaseId: UUID, trackId: UUID, in collections: [MusicCollection]) -> [MusicCollection] {
        collections.filter { collection in
            collection.items.contains { item in
                switch item {
                case .release(let id): id == releaseId
                case .track(let release, let track): release == releaseId && track == trackId
                case .unknown: false
                }
            }
        }
    }
}
