import SwiftUI
import PhotosUI

/// The import screens' cover control: the record sleeve, which opens a small sheet of
/// covers already in the library, then Photos, Files and Remove cover. `CoverPicker` stays
/// in the hierarchy as an invisible host so its crop sheet remains the only crop path for
/// new images; this view hands it the raw bytes through `rawPick`. A recent cover was
/// cropped when it was first saved, so it is set directly and skips the crop.
struct SleeveCoverPicker: View {
    @Binding var imageData: Data?
    @Binding var rawPick: Data?
    let ceremony: Int
    let onPickFromFiles: () -> Void
    /// The cover beat's frame (#205); nil draws the sleeve as before.
    var beat: ImportBeat.Frame?

    @Environment(\.appContainer) private var container

    @State private var cover: UIImage?
    @State private var isSheetPresented = false
    @State private var recents: [RecentCover] = []
    /// Photos or Files, chosen in the sheet and opened once it has finished closing: a
    /// picker cannot present while the sheet is still on screen.
    @State private var pendingPicker: CoverChoiceSheet.Choice?
    @State private var isPhotosPresented = false
    @State private var photosItem: PhotosPickerItem?

    var body: some View {
        RecordSleeve(cover: cover, ceremony: ceremony, beat: beat) {
            isSheetPresented = true
        }
        // Decoded once per new cover: `RecordSleeve` keys the cover on the image's
        // identity, so a fresh `UIImage` every render would replay its fade.
        .onChange(of: imageData, initial: true) { _, data in
            cover = data.flatMap { UIImage(data: $0) }
        }
        .accessibilityHint(Copy.Import.sleeveHint)
        .frame(maxWidth: .infinity)
        .sheet(isPresented: $isSheetPresented, onDismiss: openPendingPicker) {
            CoverChoiceSheet(recents: recents, hasCover: imageData != nil, onChoose: choose)
        }
        // Load when the screen appears, then again each time the sheet opens (not when it
        // closes), so a release saved or synced while this screen is up still shows; the
        // previous list stays visible while the new one loads.
        .task(id: isSheetPresented) {
            guard let container, isSheetPresented || recents.isEmpty else { return }
            let loaded = await RecentCoversLoader(library: container.library, coverStore: container.coverStore).load()
            // A cancelled load is cut short; keep the list already on screen rather than a partial one.
            guard !Task.isCancelled else { return }
            recents = loaded
        }
        // As in `CoverPicker`: the Photos picker hangs off a persistent background
        // node, never off the sheet, which is torn down when it closes.
        .background {
            Color.clear
                .photosPicker(isPresented: $isPhotosPresented, selection: $photosItem, matching: .images)
        }
        .task(id: photosItem) {
            guard let photosItem else { return }
            if let data = try? await photosItem.loadTransferable(type: Data.self) {
                rawPick = data
            }
            // Clear the selection so picking the same photo again re-triggers.
            self.photosItem = nil
        }
        // The crop sheet's host; invisible and inert.
        .background {
            CoverPicker(imageData: $imageData, rawPick: $rawPick, style: .compact, onPickFromFiles: onPickFromFiles)
                .frame(width: 0, height: 0)
                .opacity(0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private func choose(_ choice: CoverChoiceSheet.Choice) {
        switch choice {
        case .recent(let recent):
            if let data = container?.coverStore.load(recent.id) { imageData = data }
        case .remove:
            imageData = nil
        case .photos, .files:
            pendingPicker = choice
        }
        isSheetPresented = false
    }

    private func openPendingPicker() {
        guard let choice = pendingPicker else { return }
        pendingPicker = nil
        switch choice {
        case .photos: isPhotosPresented = true
        case .files: onPickFromFiles()
        case .recent, .remove: break
        }
    }
}
