import SwiftUI

/// A collection's cover: one cover when it has one release, otherwise a 2x2 of the first four (computed here,
/// never stored). The square is reserved at its final size, so nothing moves when the art loads; it is
/// decoration (the name carries the meaning).
struct CollectionCoverView: View {
    @Environment(\.appContainer) private var container

    let releaseIDs: [UUID]
    var side: CGFloat = Theme.Library.thumbnailSize
    var cornerRadius: CGFloat = Theme.Radius.thumbnail
    /// The first cover, once loaded (the album page's disc takes its label from it).
    var onFirstImage: ((UIImage?) -> Void)?

    @State private var images: [UIImage] = []

    var body: some View {
        Color.clear
            .frame(width: side, height: side)
            .overlay { art }
            .clipShape(.rect(cornerRadius: cornerRadius))
            .accessibilityHidden(true)
            .task(id: releaseIDs) {
                let store = container?.coverStore
                let ids = releaseIDs
                images = await Task.detached(priority: .utility) {
                    ids.compactMap { id in store?.load(id).flatMap { UIImage(data: $0) } }
                }.value
                onFirstImage?(images.first)
            }
    }

    @ViewBuilder
    private var art: some View {
        if images.count >= 4 {
            VStack(spacing: 0) {
                ForEach(0..<2, id: \.self) { row in
                    HStack(spacing: 0) {
                        ForEach(0..<2, id: \.self) { column in tile(images[row * 2 + column]) }
                    }
                }
            }
        } else if let first = images.first {
            tile(first)
        } else {
            NoCoverArt()
        }
    }

    private func tile(_ image: UIImage) -> some View {
        Color.clear.overlay { Image(uiImage: image).resizable().scaledToFill() }.clipped()
    }
}
