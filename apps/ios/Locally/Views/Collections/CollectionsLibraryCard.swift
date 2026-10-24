import SwiftUI

/// The Collections card at the top of the Library (#360): one glass button that pushes the Collections
/// screen, with the first collections' covers fanned out of its left edge like records peeking from a
/// crate, then "Collections", the count and a chevron. With no collections it still opens the screen,
/// with the plan's line under the title. ("New collection" lives on the Collections screen.)
struct CollectionsLibraryCard: View {
    let model: CollectionsModel
    var onOpen: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if let failure = model.readFailure {
            // Not "no collections": the store could not be read.
            ReadFailureView(message: failure, compact: true) { model.reload() }
        } else if model.isLoaded {
            Button(action: onOpen) {
                // At the accessibility sizes the covers sit above the words, so "Collections" is never broken mid-word.
                let layout = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                    : AnyLayout(HStackLayout(spacing: 14))
                layout {
                    sleeves
                    HStack(spacing: 14) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Copy.Collections.title)
                                .themeFont(.rowTitle)
                                .foregroundStyle(Theme.primaryText)
                            Text(subtitle)
                                .themeFont(.meta)
                                .foregroundStyle(Theme.secondaryText)
                                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        LocallyIcon(.chevronRight, size: 18, relativeTo: .footnote)
                            .foregroundStyle(Theme.textDim)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, minHeight: Theme.Library.collectionsCardMinHeight, alignment: .leading)
                .background(glass)
                .contentShape(RoundedRectangle(cornerRadius: Theme.Library.collectionsCardRadius, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel(model.collections.isEmpty ? Copy.Collections.title : "\(Copy.Collections.title), \(subtitle)")
            .accessibilityHint(Copy.Collections.libraryRowHint)
        }
    }

    private var subtitle: String {
        model.collections.isEmpty ? Copy.Collections.emptyLine : Copy.Collections.countLine(model.collections.count)
    }

    /// The first three collections, the first in front; each one behind peeks out further to the right and tilts.
    private var sleeves: some View {
        let shown = Array(model.collections.prefix(3))
        let side = Theme.Library.collectionsCardSleeve
        let step = Theme.Library.collectionsCardSleeveStep
        return ZStack(alignment: .leading) {
            if shown.isEmpty {
                CollectionCoverView(releaseIDs: [], side: side)
                    .shadow(color: .black.opacity(0.4), radius: 5, y: 3)
            } else {
                ForEach(Array(shown.enumerated().reversed()), id: \.element.id) { index, collection in
                    CollectionCoverView(releaseIDs: model.coverReleaseIDs(of: collection), side: side)
                        .shadow(color: .black.opacity(0.4), radius: 5, y: 3)
                        .rotationEffect(.degrees(Theme.Library.collectionsCardTilt * Double(index)))
                        .offset(x: step * CGFloat(index))
                }
            }
        }
        .frame(width: side + step * CGFloat(max(shown.count - 1, 0)), height: side + 8, alignment: .leading)
        .accessibilityHidden(true)
    }

    /// Faked glass: the panel fill, a top highlight, a rim and a soft drop shadow.
    private var glass: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Library.collectionsCardRadius, style: .continuous)
        return shape.fill(Theme.Immersive.panelFill)
            .overlay(shape.fill(LinearGradient(colors: [.white.opacity(0.10), .clear], startPoint: .top, endPoint: .center)))
            .overlay(shape.stroke(Theme.Immersive.panelStroke, lineWidth: 1))
            .shadow(color: .black.opacity(0.3), radius: 10, y: 4)
    }
}
