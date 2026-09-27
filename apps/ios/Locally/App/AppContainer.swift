import Foundation
import SwiftData
import SwiftUI
import UIKit

/// Observable connection status for Spotify's folder, so SwiftUI views
/// (`RootView`, `SettingsView`) can react to onboarding/reconnect without
/// re-reading `SpotifyFolderAccess.isConnected` (a plain, non-observable
/// property) on every render.
@Observable
final class FolderStatus {
    var isConnected: Bool
    init(isConnected: Bool) { self.isConnected = isConnected }
}

/// Observable purchase status, for the same reason `FolderStatus` exists:
/// `PurchaseService.isFullUnlocked` is a plain, non-observable property, so
/// `SettingsView` binds to this instead and `AppContainer` keeps it in sync
/// after a purchase, a restore, or a startup refresh.
@Observable
final class PurchaseStatus {
    var isFullUnlocked: Bool
    init(isFullUnlocked: Bool) { self.isFullUnlocked = isFullUnlocked }
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
    let inbox: InboxStore
    let purchase: PurchaseService
    let syncAccount: SyncAccountStore
    let syncApi: SyncApi
    let syncEngine: SyncEngine
    let folderStatus: FolderStatus
    let purchaseStatus: PurchaseStatus
    let modelContainer: ModelContainer

    /// What Settings and the Import tab bind to for sync — same object as
    /// `syncEngine.status`, exposed here so views don't need to reach
    /// through the engine just to read it.
    var syncStatus: SyncStatus { syncEngine.status }

    init(
        folder: SpotifyFolderAccess,
        library: LibraryStore,
        importer: FileImporter,
        coordinator: ReleaseCoordinator,
        coverStore: CoverStore,
        inbox: InboxStore,
        purchase: PurchaseService,
        syncAccount: SyncAccountStore,
        syncApi: SyncApi,
        syncEngine: SyncEngine,
        modelContainer: ModelContainer
    ) {
        self.folder = folder
        self.library = library
        self.importer = importer
        self.coordinator = coordinator
        self.coverStore = coverStore
        self.inbox = inbox
        self.purchase = purchase
        self.syncAccount = syncAccount
        self.syncApi = syncApi
        self.syncEngine = syncEngine
        self.modelContainer = modelContainer
        self.folderStatus = FolderStatus(isConnected: folder.isConnected)
        self.purchaseStatus = PurchaseStatus(isFullUnlocked: purchase.isFullUnlocked)
        coordinator.syncHook = syncEngine
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

    /// Re-checks the purchase's current entitlement and syncs
    /// `purchaseStatus`, so `SettingsView` reflects a purchase or restore
    /// made just now, or one that happened on another device.
    func refreshPurchaseStatus() async {
        await purchase.refreshEntitlement()
        purchaseStatus.isFullUnlocked = purchase.isFullUnlocked
    }

    static func production() -> AppContainer {
        let modelContainer = Self.makeModelContainer(inMemory: false)
        let folder = UserDefaultsSpotifyFolder()
        let library = SwiftDataLibraryStore(context: modelContainer.mainContext)
        let importer = LocalFileImporter()
        let transcoder = AVTranscoder()
        let coverStore = FileCoverStore()
        let inbox = AppGroupInboxStore()
        let purchase = StoreKitPurchaseService()
        let coordinator = ReleaseCoordinator(
            importer: importer,
            transcoder: transcoder,
            m4aTagWriter: M4ATagWriter(),
            id3TagWriter: ID3TagWriter(),
            folder: folder,
            library: library,
            coverStore: coverStore
        )
        let syncAccount = UserDefaultsSyncAccountStore()
        let syncApi = HttpSyncApi(account: syncAccount)
        let syncEngine = SyncEngine(
            api: syncApi,
            account: syncAccount,
            library: library,
            coordinator: coordinator,
            deviceName: { UIDevice.current.name }
        )
        let container = AppContainer(
            folder: folder,
            library: library,
            importer: importer,
            coordinator: coordinator,
            coverStore: coverStore,
            inbox: inbox,
            purchase: purchase,
            syncAccount: syncAccount,
            syncApi: syncApi,
            syncEngine: syncEngine,
            modelContainer: modelContainer
        )
        Task { await container.refreshPurchaseStatus() }
        return container
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
        coverStore: CoverStore,
        inbox: InboxStore,
        purchase: PurchaseService,
        syncAccount: SyncAccountStore,
        syncApi: SyncApi,
        deviceName: @escaping () -> String = { "Test Device" }
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
        let syncEngine = SyncEngine(
            api: syncApi,
            account: syncAccount,
            library: library,
            coordinator: coordinator,
            deviceName: deviceName
        )
        return AppContainer(
            folder: folder,
            library: library,
            importer: importer,
            coordinator: coordinator,
            coverStore: coverStore,
            inbox: inbox,
            purchase: purchase,
            syncAccount: syncAccount,
            syncApi: syncApi,
            syncEngine: syncEngine,
            modelContainer: modelContainer
        )
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
