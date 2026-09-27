import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Lets the user pick a cover image from Photos or from Files, showing a
/// thumbnail once one is chosen. Used by both the single-track and
/// (phase 2) album import flows.
struct CoverPicker: View {
    @Binding var imageData: Data?

    @State private var photosItem: PhotosPickerItem?
    @State private var isPresentingFileImporter = false

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
                    Button {
                        isPresentingFileImporter = true
                    } label: {
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
        .fileImporter(isPresented: $isPresentingFileImporter, allowedContentTypes: [.image]) { result in
            guard case .success(let url) = result else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            imageData = try? Data(contentsOf: url)
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
