import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Lets the user pick a cover image from Photos or from Files, showing a
/// thumbnail once one is chosen. Used by both the single-track and album
/// import flows (`.dropZone`, a square drop-zone card) and the release
/// detail's cover replacer (`.hero`, the full-width editor cover with an
/// "Edit" pill overlay).
///
/// Neither pick path writes `imageData` directly: both first land in
/// `pendingCrop`, which presents `CoverCropView` so the user frames the
/// square (or original) Spotify will show. Only Done writes `imageData`;
/// Cancel leaves it untouched.
struct CoverPicker: View {
    /// Which of the two presentations to draw. See `docs/design.md`'s
    /// "Cover drop zone" and "Editor / release detail" components.
    enum Style { case dropZone, hero, compact }

    @Binding var imageData: Data?
    /// The parent owns the file importer: SwiftUI honours only one
    /// `.fileImporter` per presentation context, so a nested one here
    /// would never present while the parent also has one for audio (or,
    /// for the album builder, the multi-file picker). The parent sets this
    /// once it has raw bytes from that picker; `CoverPicker` consumes it
    /// (setting it back to `nil`) and presents the crop sheet for it.
    @Binding var rawPick: Data?
    var style: Style = .dropZone
    let onPickFromFiles: () -> Void

    @State private var photosItem: PhotosPickerItem?
    @State private var isPhotosPresented = false
    @State private var pendingCrop: Data?

    var body: some View {
        Group {
            switch style {
            case .dropZone: dropZoneBody
            case .hero: heroBody
            case .compact: compactBody
            }
        }
        // The Photos picker is attached here, to a view that stays in the
        // hierarchy, not to the `Menu` item that asks for it: a `PhotosPicker`
        // placed inside a `Menu` is torn down with the menu when it closes,
        // so the picker never appears. Hanging it off a hidden background
        // also keeps it clear of the crop `.sheet` below (one presentation
        // modifier per view node).
        .background {
            Color.clear
                .photosPicker(isPresented: $isPhotosPresented, selection: $photosItem, matching: .images)
        }
        .task(id: photosItem) {
            guard let photosItem else { return }
            if let data = try? await photosItem.loadTransferable(type: Data.self) {
                pendingCrop = data
            }
            // Clear the selection so picking the same photo again re-triggers.
            self.photosItem = nil
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

    @ViewBuilder
    private var menuItems: some View {
        Button { isPhotosPresented = true } label: {
            Label("Photos", systemImage: "photo.on.rectangle")
        }
        Button(action: onPickFromFiles) {
            Label("Files", systemImage: "folder")
        }
    }

    // MARK: - Drop zone (import screens)

    private var dropZoneBody: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.labelGap) {
            Text(Copy.Import.cover).fieldLabelStyle()

            // `Menu` sizes its label to its own intrinsic content and
            // ignores a `.frame`/`.aspectRatio` applied directly to it (or
            // to its label) when the surrounding proposed height is
            // unbounded, as it is inside this `ScrollView` — the label
            // silently renders oversized instead of a full-width square.
            // Sizing a plain `Color.clear` first, then overlaying the
            // interactive `Menu` on its already-resolved, finite frame,
            // sidesteps that ambiguity.
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .overlay {
                    Menu {
                        menuItems
                    } label: {
                        dropZonePanel
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    .buttonStyle(.plain)
                }
                .dropZone()

            Text(Copy.Import.coverHint)
                .font(Theme.Font.dropZoneHint)
                .foregroundStyle(Theme.textHint)
        }
    }

    // MARK: - Compact square (beside the Title and Artist fields)

    /// A fixed 120 pt square that sits to the left of the first fields, so
    /// the cover is visible from the start without taking the whole row.
    private var compactBody: some View {
        Menu {
            menuItems
        } label: {
            Group {
                if let imageData, let uiImage = UIImage(data: imageData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                } else {
                    VStack(spacing: 6) {
                        Image(systemName: "photo.badge.plus")
                            .font(.system(size: 24))
                            .foregroundStyle(Theme.secondaryText)
                        Text(Copy.Import.cover)
                            .font(Theme.Font.rowSubtitle)
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
            }
            .frame(width: 120, height: 120)
            .clipped()
        }
        .buttonStyle(.plain)
        .dropZone()
        .accessibilityLabel(Copy.Import.coverCaption)
    }

    /// The chosen image once one exists, otherwise an image-plus icon and
    /// the caption. Sizing and the `card`/dashed-border chrome are applied
    /// by the caller, to the `Menu` itself.
    @ViewBuilder
    private var dropZonePanel: some View {
        if let imageData, let uiImage = UIImage(data: imageData) {
            Image(uiImage: uiImage)
                .resizable()
                .scaledToFill()
        } else {
            VStack(spacing: 8) {
                Image(systemName: "photo.badge.plus")
                    .font(.system(size: 28))
                    .foregroundStyle(Theme.secondaryText)
                Text(Copy.Import.coverCaption)
                    .font(Theme.Font.dropZoneLine)
                    .foregroundStyle(Theme.primaryText.opacity(0.85))
            }
        }
    }

    // MARK: - Hero (release detail editor)

    /// A full-width square cover, radius 10 with a soft shadow, and a small
    /// "Edit" pill overlay bottom-right that opens the same Photos/Files menu.
    private var heroBody: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let imageData, let uiImage = UIImage(data: imageData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                } else {
                    ZStack {
                        Theme.card
                        Image(systemName: "music.note")
                            .font(.system(size: 40))
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
            }
            .aspectRatio(1, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.bigCover))
            .shadow(color: .black.opacity(0.45), radius: 18, x: 0, y: 12)

            Menu {
                menuItems
            } label: {
                Label(Copy.Detail.edit, systemImage: "pencil")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background {
                        Capsule()
                            .fill(.black.opacity(0.8))
                            .background(.ultraThinMaterial, in: Capsule())
                    }
            }
            .buttonStyle(.plain)
            .padding(12)
        }
    }
}
