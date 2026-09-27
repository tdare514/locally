import SwiftUI

/// The Import tab's root: a segmented control switches between the
/// single-track flow (`ImportSingleView`, phase 1) and the album builder
/// (`AlbumBuilderView`, phase 2). Owns the one `NavigationStack` for both —
/// each child view supplies only its own content, never its own stack or
/// `.fileImporter` conflicting with the other's, since only one is in the
/// tree at a time.
struct ImportView: View {
    private enum Kind: Hashable {
        case single, album
    }

    @State private var kind: Kind = .single

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $kind) {
                    Text(Copy.Import.kindSingle).tag(Kind.single)
                    Text(Copy.Import.kindAlbum).tag(Kind.album)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)
                .padding(.top, 12)

                Group {
                    switch kind {
                    case .single:
                        ImportSingleView()
                    case .album:
                        AlbumBuilderView()
                    }
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Copy.Import.title)
        }
    }
}
