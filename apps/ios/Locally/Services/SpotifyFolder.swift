import Foundation

/// Holds the security-scoped bookmark to the Spotify Local Files folder the
/// user picked once during onboarding, and brackets every access to it with
/// `startAccessingSecurityScopedResource`/`stop`. A stale bookmark (Spotify
/// reinstalled, Local Files turned off) surfaces as `LocallyError.folderLost`
/// rather than crashing or silently no-op-ing.
protocol SpotifyFolderAccess {
    var isConnected: Bool { get }
    func connect(url: URL) throws
    func withAccess<T>(_ body: (URL) throws -> T) throws -> T
    /// Same contract as the synchronous `withAccess`, but keeps the
    /// security scope open across an `async` body — needed to re-tag a
    /// track file in place, since `M4ATagWriter` re-tags via an `async`
    /// `AVAssetExportSession` export that must run while the Spotify
    /// folder's scope is still active.
    func withAccess<T>(_ body: (URL) async throws -> T) async throws -> T
    func disconnect()
}

/// Production `SpotifyFolderAccess`: stores the bookmark in `UserDefaults`
/// (bookmark data itself, not a path — paths under `On My iPhone` aren't
/// stable across relaunches without security scope).
final class UserDefaultsSpotifyFolder: SpotifyFolderAccess {
    private static let bookmarkKey = "com.tdare.locally.spotifyFolderBookmark"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var isConnected: Bool {
        defaults.data(forKey: Self.bookmarkKey) != nil
    }

    func connect(url: URL) throws {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        do {
            let bookmark = try url.bookmarkData(
                options: [],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            defaults.set(bookmark, forKey: Self.bookmarkKey)
        } catch {
            throw LocallyError.importFailed(error.localizedDescription)
        }
    }

    func withAccess<T>(_ body: (URL) throws -> T) throws -> T {
        guard let bookmark = defaults.data(forKey: Self.bookmarkKey) else {
            throw LocallyError.folderNotConnected
        }

        var isStale = false
        let url: URL
        do {
            url = try URL(
                resolvingBookmarkData: bookmark,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )
        } catch {
            throw LocallyError.folderLost
        }

        // `startAccessingSecurityScopedResource` returns `false` for a
        // bookmark that never needed security scope in the first place
        // (e.g. a plain local temp directory in tests) — that is not a
        // failure, so only the resolve step above can report `folderLost`.
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }

        if isStale {
            // Refresh the stored bookmark opportunistically; not fatal if it fails.
            if let refreshed = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                defaults.set(refreshed, forKey: Self.bookmarkKey)
            }
        }

        return try body(url)
    }

    func withAccess<T>(_ body: (URL) async throws -> T) async throws -> T {
        guard let bookmark = defaults.data(forKey: Self.bookmarkKey) else {
            throw LocallyError.folderNotConnected
        }

        var isStale = false
        let url: URL
        do {
            url = try URL(
                resolvingBookmarkData: bookmark,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )
        } catch {
            throw LocallyError.folderLost
        }

        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }

        if isStale {
            if let refreshed = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                defaults.set(refreshed, forKey: Self.bookmarkKey)
            }
        }

        return try await body(url)
    }

    func disconnect() {
        defaults.removeObject(forKey: Self.bookmarkKey)
    }
}
