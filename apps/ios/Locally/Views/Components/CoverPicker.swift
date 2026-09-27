import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Lets the user pick a cover image from Photos or from Files, showing a
/// thumbnail once one is chosen. Used by both the single-track and
/// (phase 2) album import flows, plus the release detail's cover replacer.
///
/// Neither pick path writes `imageData` directly: both first land in
/// `pendingCrop`, which presents `CoverCropView` so the user frames the
/// square (or original) Spotify will show. Only Done writes `imageData`;
/// Cancel leaves it untouched.
struct CoverPicker: View {
    @Binding var imageData: Data?
    /// The parent owns the file importer: SwiftUI honours only one
    /// `.fileImporter` per presentation context, so a nested one here
    /// would never present while the parent also has one for audio (or,
    /// for the album builder, the multi-file picker). The parent sets this
    /// once it has raw bytes from that picker; `CoverPicker` consumes it
    /// (setting it back to `nil`) and presents the crop sheet for it.
    @Binding var rawPick: Data?
    let onPickFromFiles: () -> Void

    @State private var photosItem: PhotosPickerItem?
    @State private var pendingCrop: Data?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.labelGap) {
            Text(Copy.Import.cover)
                .font(Theme.Font.fieldLabel)
                .foregroundStyle(Theme.secondaryText)

            Menu {
                PhotosPicker(selection: $photosItem, matching: .images) {
                    Label("Photos", systemImage: "photo.on.rectangle")
                }
                Button(action: onPickFromFiles) {
                    Label("Files", systemImage: "folder")
                }
            } label: {
                panel
            }
            .buttonStyle(.plain)
        }
        .task(id: photosItem) {
            guard let photosItem else { return }
            if let data = try? await photosItem.loadTransferable(type: Data.self) {
                pendingCrop = data
            }
        }
        .onChange(of: rawPick) { _, newValue in
            guard let newValue else { return }
            pendingCrop = newValue
            rawPick = nil
        }
        .sheet(isPresented: Binding(
            get: { pendingCrop != nil },
            set: { isPresented in if !isPresented { pendingCrop = nil } }
        )) {
            if let pendingCrop {
                CoverCropView(imageData: pendingCrop) { cropped in
                    imageData = cropped
                    self.pendingCrop = nil
                } onCancel: {
                    self.pendingCrop = nil
                }
            }
        }
    }

    /// A 120 pt square `panel` block: the chosen image once one exists,
    /// otherwise a centred muted caption. Matches `docs/design.md`'s
    /// "Cover picker" component.
    @ViewBuilder
    private var panel: some View {
        Group {
            if let imageData, let uiImage = UIImage(data: imageData) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
            } else {
                Text(Copy.Import.coverCaption)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .padding(12)
            }
        }
        .frame(width: 120, height: 120)
        .dropZone()
    }
}
