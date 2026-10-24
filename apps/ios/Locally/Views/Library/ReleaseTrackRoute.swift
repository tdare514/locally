import Foundation

/// A release pushed from one of its tracks (#362): the page scrolls that track into view and washes
/// it once. A plain `Release` push opens the page with no highlight.
struct ReleaseTrackRoute: Hashable {
    let release: Release
    let trackId: UUID
}
