import Foundation
import SwiftData
import SwiftUI

/// Observable connection status for Spotify's folder, so SwiftUI views
/// (`RootView`, `SettingsView`) can react to onboarding/reconnect without
/// re-reading `SpotifyFolderAccess.isConnected` (a plain, non-observable
/// property) on every render.
@Observable
final class FolderStatus {
    var isConnected: Bool
    init(isConnected: Bool) { self.isConnected = isConnected }
}

/// Composes every production service and the one coordinator that ties
/// them together, mirroring the web app's `container.ts`. Built once in
/// `LocallyApp` and injected into the view tree via `.environment`;
/// `forTesting` builds the same graph from caller-supplied fakes so views
/// and the coordinator can be exercised without touching disk,
/// AVFoundation, or a real SwiftData store.
@MainActor
final class AppContainer {
    let folder: SpotifyFolderAccess
    let library: LibraryStore
    let importer: FileImporter
    let coordinator: ReleaseCoordinator
    let coverStore: CoverStore
    let folderStatus: FolderStatus
    let modelContainer: ModelContainer

    init(
        folder: SpotifyFolderAccess,
        library: LibraryStore,
        importer: FileImporter,
        coordinator: ReleaseCoordinator,
        coverStore: CoverStore,
        modelContainer: ModelContainer
    ) {
        self.folder = folder
        self.library = library
        self.importer = importer
        self.coordinator = coordinator
        self.coverStore = coverStore
        self.modelContainer = modelContainer
        self.folderStatus = FolderStatus(isConnected: folder.isConnected)
    }

    /// Marks the folder connected after a successful `SpotifyFolderAccess.connect`,
    /// updating both the stored bookmark and the observable status views bind to.
    func connectFolder(url: URL) throws {
        try folder.connect(url: url)
        folderStatus.isConnected = folder.isConnected
    }

    func disconnectFolder() {
        folder.disconnect()
        folderStatus.isConnected = folder.isConnected
    }

    /// Refreshes `folderStatus` after a failed access reports the bookmark as lost.
    func refreshFolderStatus() {
        folderStatus.isConnected = folder.isConnected
    }

    static func production() -> AppContainer {
        let modelContainer = Self.makeModelContainer(inMemory: false)
        let folder = UserDefaultsSpotifyFolder()
        let library = SwiftDataLibraryStore(context: modelContainer.mainContext)
        let importer = LocalFileImporter()
        let transcoder = AVTranscoder()
        let coverStore = FileCoverStore()
        let coordinator = ReleaseCoordinator(
            importer: importer,
            transcoder: transcoder,
            m4aTagWriter: M4ATagWriter(),
            id3TagWriter: ID3TagWriter(),
            folder: folder,
            library: library,
            coverStore: coverStore
        )
        return AppContainer(folder: folder, library: library, importer: importer, coordinator: coordinator, coverStore: coverStore, modelContainer: modelContainer)
    }

    /// Builds an `AppContainer` from fakes, for previews and tests. Every
    /// service is caller-supplied so this target never needs to know about
    /// fake types defined in `LocallyTests`.
    static func forTesting(
        folder: SpotifyFolderAccess,
        library: LibraryStore,
        importer: FileImporter,
        transcoder: Transcoder,
        m4aTagWriter: TagWriter,
        id3TagWriter: TagWriter,
        coverStore: CoverStore
    ) -> AppContainer {
        let modelContainer = Self.makeModelContainer(inMemory: true)
        let coordinator = ReleaseCoordinator(
            importer: importer,
            transcoder: transcoder,
            m4aTagWriter: m4aTagWriter,
            id3TagWriter: id3TagWriter,
            folder: folder,
            library: library,
            coverStore: coverStore
        )
        return AppContainer(folder: folder, library: library, importer: importer, coordinator: coordinator, coverStore: coverStore, modelContainer: modelContainer)
    }

    private static func makeModelContainer(inMemory: Bool) -> ModelContainer {
        let configuration = ModelConfiguration(isStoredInMemoryOnly: inMemory)
        // swiftlint:disable:next force_try
        return try! ModelContainer(for: ReleaseRecord.self, configurations: configuration)
    }
}

private struct AppContainerKey: EnvironmentKey {
    static let defaultValue: AppContainer? = nil
}

extension EnvironmentValues {
    var appContainer: AppContainer? {
        get { self[AppContainerKey.self] }
        set { self[AppContainerKey.self] = newValue }
    }
}
