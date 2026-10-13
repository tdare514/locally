import SwiftUI
import PhotosUI

/// The import screens' cover control: the record sleeve, which opens a Photos / Files
/// choice. `CoverPicker` stays in the hierarchy as an invisible host so its crop sheet
/// remains the only crop path; this view hands it the raw bytes through `rawPick`.
struct SleeveCoverPicker: View {
    @Binding var imageData: Data?
    @Binding var rawPick: Data?
    let ceremony: Int
    let onPickFromFiles: () -> Void

    @State private var cover: UIImage?
    @State private var isDialogPresented = false
    @State private var isPhotosPresented = false
    @State private var photosItem: PhotosPickerItem?

    var body: some View {
        RecordSleeve(cover: cover, ceremony: ceremony) {
            isDialogPresented = true
        }
        // Decoded once per new cover: `RecordSleeve` keys the cover on the image's
        // identity, so a fresh `UIImage` every render would replay its fade.
        .onChange(of: imageData, initial: true) { _, data in
            cover = data.flatMap { UIImage(data: $0) }
        }
        .accessibilityHint(Copy.Import.sleeveHint)
        .frame(maxWidth: .infinity)
        .confirmationDialog(Copy.Import.coverDialogTitle, isPresented: $isDialogPresented) {
            Button(Copy.Import.coverFromPhotos) { isPhotosPresented = true }
            Button(Copy.Import.coverFromFiles, action: onPickFromFiles)
            if imageData != nil {
                Button(Copy.Import.removeCover, role: .destructive) { imageData = nil }
            }
        }
        // As in `CoverPicker`: the Photos picker hangs off a persistent background
        // node, never off the dialog, which is torn down when it closes.
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
}
