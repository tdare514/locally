import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Lets the user pick a cover image from Photos or from Files, showing a
/// thumbnail once one is chosen. Used by both the single-track and
/// (phase 2) album import flows.
struct CoverPicker: View {
    @Binding var imageData: Data?
    /// The parent owns the file importer: SwiftUI honours only one
    /// `.fileImporter` per presentation context, so a nested one here
    /// would never present while the parent also has one for audio.
    let onPickFromFiles: () -> Void

    @State private var photosItem: PhotosPickerItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(Copy.Import.cover)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)

            HStack(spacing: 12) {
                thumbnail

                VStack(alignment: .leading, spacing: 8) {
                    PhotosPicker(selection: $photosItem, matching: .images) {
                        Label("Photos", systemImage: "photo.on.rectangle")
                    }
                    Button(action: onPickFromFiles) {
                        Label("Files", systemImage: "folder")
                    }
                }
                .foregroundStyle(Theme.accent)
            }
        }
        .task(id: photosItem) {
            guard let photosItem else { return }
            if let data = try? await photosItem.loadTransferable(type: Data.self) {
                imageData = data
            }
        }
    }

    @ViewBuilder
    private var thumbnail: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Theme.panel)
            .frame(width: 64, height: 64)
            .overlay {
                if let imageData, let uiImage = UIImage(data: imageData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                } else {
                    Image(systemName: "music.note")
                        .foregroundStyle(Theme.secondaryText)
                }
            }
    }
}
