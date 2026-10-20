import SwiftUI

/// The Artist `LabeledField` with the library's artists behind it (#287): suggestion pills on the
/// keyboard and a "Did you mean" line. The index is built once when the field appears, from the
/// releases the library already holds; a read-only field (view mode, adopted) never loads it.
struct ArtistField: View {
    @Binding var text: String
    var isEditable = true

    @Environment(\.appContainer) private var container
    @State private var index: [ArtistEntry]?

    var body: some View {
        LabeledField(Copy.Import.fieldArtist, placeholder: Copy.Import.artistPlaceholder, text: $text, font: Theme.ScaledFont.input, wraps: true, isEditable: isEditable, artistIndex: isEditable ? index : nil)
            // Fires on every change of `isEditable`: each Edit tap reads the library again, so counts
            // from a save are not stale, and leaving edit mode drops the index.
            .task(id: isEditable) { @MainActor in
                guard isEditable, let container else {
                    index = nil
                    return
                }
                index = ArtistIndex.build((try? container.library.all()) ?? [])
            }
    }
}

/// The keyboard-toolbar row of library artists (#287), shared by the Artist and Featuring fields.
struct ArtistPillRow: View {
    let entries: [ArtistEntry]
    let onPick: (ArtistEntry) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(entries, id: \.key) { entry in
                    Button {
                        onPick(entry)
                    } label: {
                        Text(Copy.ArtistSuggest.pill(artist: entry.display, trackCount: entry.trackCount))
                            .font(Theme.ScaledFont.subheadline)
                            .foregroundStyle(Theme.Tint.accentText)
                            .lineLimit(1)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 44)
                            .background(Capsule().fill(Theme.accent.opacity(0.18)))
                            .contentShape(Capsule())
                    }
                    .accessibilityLabel(Copy.ArtistSuggest.pillLabel(artist: entry.display, trackCount: entry.trackCount))
                }
            }
        }
        .accessibilityLabel(Copy.ArtistSuggest.pillsLabel)
    }
}
