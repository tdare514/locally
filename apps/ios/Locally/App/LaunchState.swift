import Foundation

/// Whether the library index opened at launch. A failure is shown by
/// `StoreErrorView` instead of crashing, because the user's release list
/// lives in that store.
@MainActor
enum LaunchState {
    case ready(AppContainer)
    case failed(String)

    static func open() -> LaunchState {
        do {
            return .ready(try AppContainer.production())
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    /// Moves the store aside (keeping it as a backup), then tries again.
    static func resetAndOpen() -> LaunchState {
        do {
            try ModelStore.moveAside(storeAt: ModelStore.defaultURL)
        } catch {
            return .failed(error.localizedDescription)
        }
        return open()
    }
}
