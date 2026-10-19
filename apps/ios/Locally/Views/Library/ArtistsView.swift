import SwiftUI

/// The covers for the Artists view and the artist page (#288): a `StatsCoverCache` that starts
/// over whenever a release's cover could have changed (its `updatedAt` moved), so a replaced cover
/// shows when the reader comes back to the list.
@MainActor
@Observable
final class ArtistCoverSource {
    private struct Signature: Hashable {
        let id: UUID
        let updatedAt: Date
    }

    private(set) var cache: StatsCoverCache
    /// Changes with `cache`, so cover views reload.
    private(set) var generation = 0
    @ObservationIgnored private let loader: StatsCoverCache.Loader
    @ObservationIgnored private var signature: Set<Signature> = []

    init(loader: @escaping StatsCoverCache.Loader) {
        self.loader = loader
        cache = StatsCoverCache(loader: loader)
    }

    func refresh(_ releases: [Release]) {
        let next = Set(releases.map { Signature(id: $0.id, updatedAt: $0.updatedAt) })
        guard next != signature else { return }
        if !signature.isEmpty {
            cache = StatsCoverCache(loader: loader)
            generation += 1
        }
        signature = next
    }
}

/// Up to three covers fanned like sleeves on a shelf: the newest in front, the others offset up and
/// to the right with a small turn.
struct ArtistCoverStack: View {
    let releases: [Release]
    let source: ArtistCoverSource
    var size: CGFloat = 52

    var body: some View {
        let shown = Array(releases.prefix(ArtistCatalog.coverLimit))
        let cover = size * 0.7
        let step = (size - cover) / CGFloat(max(ArtistCatalog.coverLimit - 1, 1))
        ZStack(alignment: .bottomLeading) {
            ForEach(Array(shown.enumerated().reversed()), id: \.element.id) { index, release in
                StatsCoverView(owner: release.id, cache: source.cache, cornerRadius: 4)
                    .id(source.generation)
                    .frame(width: cover, height: cover)
                    .shadow(color: .black.opacity(0.35), radius: 3, y: 1)
                    .rotationEffect(.degrees(Double(index) * 4), anchor: .bottomLeading)
                    .offset(x: CGFloat(index) * step, y: -CGFloat(index) * step)
            }
        }
        .frame(width: size, height: size, alignment: .bottomLeading)
        .accessibilityHidden(true)
    }
}

/// The Artists view's list (#288): letter headings between translucent panels of rows, each a
/// small cover stack, the name and a count line, and the library's chevron. A row opens the artist page.
struct ArtistsListView: View {
    let groups: [ArtistCatalog.Group]
    let source: ArtistCoverSource

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var stackSize: CGFloat = 52

    private var wraps: Bool { dynamicTypeSize.isAccessibilitySize }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(groups, id: \.letter) { group in
                VStack(alignment: .leading, spacing: 8) {
                    Text(group.letter)
                        .font(Font.system(.headline, weight: .bold))
                        .foregroundStyle(Theme.primaryText)
                        .padding(.horizontal, 4)
                        .frame(minHeight: Theme.Library.sectionHeaderMinHeight, alignment: .leading)
                        .accessibilityAddTraits(.isHeader)
                    panel(group.entries)
                }
            }
        }
    }

    private func panel(_ entries: [ArtistCatalogEntry]) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Library.listPanelCornerRadius, style: .continuous)
        return VStack(spacing: 0) {
            ForEach(Array(entries.enumerated()), id: \.element.key) { index, entry in
                NavigationLink(value: ArtistRoute(key: entry.key)) { row(entry) }
                    .buttonStyle(PressAwareStyle(rowHighlight: true, onPress: {}))
                if index < entries.count - 1 {
                    Rectangle().fill(Theme.Immersive.panelStroke).frame(height: 1)
                }
            }
        }
        .background(shape.fill(Theme.Immersive.panelFill))
        .clipShape(shape)
        .overlay(shape.stroke(Theme.Immersive.panelStroke, lineWidth: 1))
    }

    private func row(_ entry: ArtistCatalogEntry) -> some View {
        let count = Copy.Artists.countLine(releases: entry.releaseCount, tracks: entry.trackCount, appearsOn: entry.appearsOn.count)
        return HStack(spacing: 12) {
            ArtistCoverStack(releases: entry.covers, source: source, size: min(stackSize, 76))
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name)
                    .font(Font.system(.subheadline, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(wraps ? 3 : 1)
                Text(count)
                    .font(Font.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(wraps ? 3 : 1)
            }
            Spacer()
            LocallyIcon(.chevronRight, size: 20, scaled: false)
                .foregroundStyle(Theme.textDim)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 72)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Copy.Artists.rowLabel(name: entry.name, countLine: count))
    }
}
