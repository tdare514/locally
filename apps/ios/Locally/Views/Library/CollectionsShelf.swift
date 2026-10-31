import SwiftUI

/// The Collections shelf under the Library's cards (#446): "Collections" with its count and "See all", then a sideways
/// row of tiles (the collection's cover at radius 8, its name and its track count) ending in a "New collection" tile.
/// A tile opens that collection; See all opens the Collections screen; New starts the builder. Nothing here glows or
/// is tinted with a cover: the covers are the colour. With no collections the row is the New tile and the plan's line.
struct CollectionsShelf: View {
    let model: CollectionsModel
    var onOpen: (UUID) -> Void
    var onSeeAll: () -> Void
    var onNew: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var scaledTile = Theme.Library.shelfTile
    /// The tile grows with the text, but two still show at the largest sizes.
    private var tile: CGFloat { min(scaledTile, 168) }
    private var wraps: Bool { dynamicTypeSize.isAccessibilitySize }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            titleRow
            content
        }
    }

    private var titleRow: some View {
        // At the accessibility sizes "See all" drops under the title instead of squeezing it into pieces.
        let row = wraps
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
        return row {
            HStack(alignment: .firstTextBaseline) {
                Text(Copy.Collections.title)
                    .themeFont(.sectionTitle)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .accessibilityAddTraits(.isHeader)
                if model.isLoaded, model.readFailure == nil, !model.collections.isEmpty {
                    Text(Copy.Library.sectionCount(model.collections.count))
                        .themeFont(.meta)
                        .foregroundStyle(Theme.textDim)
                }
            }
            if !wraps { Spacer(minLength: 8) }
            Button(action: onSeeAll) {
                HStack(spacing: 4) {
                    Text(Copy.Library.seeAll)
                        .lineLimit(1)
                    LocallyIcon(.chevronRight, size: 14, relativeTo: .footnote)
                }
                .fixedSize()
            }
            .buttonStyle(TextButtonStyle())
            .accessibilityLabel(Copy.Library.seeAllLabel)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
        .frame(minHeight: Theme.Library.sectionHeaderMinHeight)
    }

    @ViewBuilder
    private var content: some View {
        if let failure = model.readFailure {
            // Not "no collections": the store could not be read.
            ReadFailureView(message: failure, compact: true) { model.reload() }
        } else if !model.isLoaded {
            placeholder
        } else {
            // Bleeds to the screen's edges, so the row scrolls under the page's gutters.
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: Theme.Library.shelfGap) {
                    ForEach(model.summaries) { summary in collectionTile(summary) }
                    newTile
                    if model.collections.isEmpty {
                        Text(Copy.Collections.emptyLine)
                            .themeFont(.meta)
                            .foregroundStyle(Theme.secondaryText)
                            .frame(width: tile * 1.6, alignment: .leading)
                    }
                }
            }
            .contentMargins(.horizontal, Theme.Spacing.listPagePadding, for: .scrollContent)
            .padding(.horizontal, -Theme.Spacing.listPagePadding)
        }
    }

    private func collectionTile(_ summary: CollectionSummary) -> some View {
        Button { onOpen(summary.id) } label: {
            VStack(alignment: .leading, spacing: 6) {
                CollectionCoverView(releaseIDs: summary.coverReleaseIDs, side: tile, cornerRadius: Theme.Radius.tile)
                VStack(alignment: .leading, spacing: 0) {
                    Text(summary.name)
                        .themeFont(.rowTitle)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(wraps ? 3 : 1)
                    Text(Copy.Collections.trackCount(summary.tracks))
                        .themeFont(.meta)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }
            }
            .frame(width: tile, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(ShelfTileStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(Copy.Collections.rowLabel(name: summary.name, tracks: summary.tracks))
        .accessibilityHint(Copy.Library.openCollectionHint)
    }

    /// A tile the size of a cover, on `elevated`, with a plus; it opens the builder.
    private var newTile: some View {
        Button(action: onNew) {
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: Theme.Radius.tile, style: .continuous)
                    .fill(Theme.elevated)
                    .frame(width: tile, height: tile)
                    .overlay {
                        LocallyIcon(.plus, size: 26, relativeTo: .body)
                            .foregroundStyle(Theme.secondaryText)
                    }
                Text(Copy.Collections.newCollection)
                    .themeFont(.rowTitle)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(wraps ? 3 : 1)
            }
            .frame(width: tile, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(ShelfTileStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(Copy.Collections.newCollection)
        .accessibilityHint(Copy.Library.newCollectionHint)
    }

    /// Still shapes in the tiles' size while the store is first read, shown after 300 ms.
    private var placeholder: some View {
        DelayedSkeleton(label: Copy.Collections.title) {
            HStack(alignment: .top, spacing: Theme.Library.shelfGap) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: Theme.Radius.tile, style: .continuous)
                        .fill(Theme.skeletonFill)
                        .frame(width: tile, height: tile)
                }
            }
            .padding(.bottom, 40)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A shelf tile pressed: a little less opacity, nothing else (design rule 2).
private struct ShelfTileStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.7 : 1)
    }
}
