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
            .task(id: isEditable) { @MainActor in
                guard isEditable, index == nil, let container else { return }
                index = ArtistIndex.build((try? container.library.all()) ?? [])
            }
    }
}
