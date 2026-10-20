import SwiftUI

/// Grouping for the Stats grid (port of `apps/web/src/lib/stats-layout.ts`). Pure.
enum StatsSeaLayout {
    /// How many covers sit in each of the sea's first two sizes; everything after is the third.
    static let tierSizes = [6, 8]

    /// The sea in rank order, cut into three sizes: the first six biggest, the next eight middling,
    /// the rest small. Empty groups are dropped.
    static func tiers<T>(_ items: [T]) -> [[T]] {
        let first = tierSizes[0]
        let second = tierSizes[1]
        let groups = [
            Array(items.prefix(first)),
            Array(items.dropFirst(first).prefix(second)),
            Array(items.dropFirst(first + second)),
        ]
        return groups.filter { !$0.isEmpty }
    }

    /// Columns per tier from the room the sea has: the Mac's container-query table, where the last
    /// rule that fits wins. A tile is never under 72 pt and a better-ranked cover is never smaller.
    static func columns(forWidth width: CGFloat) -> [Int] {
        let table: [(min: CGFloat, cols: [Int])] = [
            (150, [2, 2, 2]), (240, [2, 3, 3]), (324, [3, 4, 4]), (408, [3, 4, 5]), (492, [4, 5, 6]),
            (500, [3, 4, 5]), (564, [4, 5, 6]), (660, [5, 6, 7]), (756, [5, 7, 8]), (800, [5, 6, 7]),
            (852, [5, 7, 8]), (960, [6, 8, 9]), (1000, [5, 7, 8]), (1068, [6, 8, 9]), (1188, [7, 9, 10]),
            (1308, [7, 10, 11]),
        ]
        var cols = [2, 2, 2]
        for rule in table where width >= rule.min { cols = rule.cols }
        return cols
    }
}

/// The ranked list under the fan: one glass card of rows. Each row is one button.
struct StatsList: View {
    let items: [StatItem]
    let today: String
    let round: Bool
    let cache: StatsCoverCache
    let ownerOf: (StatItem) -> UUID?
    let label: String
    let onOpen: (StatItem) -> Void

    var body: some View {
        GlassCard {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { GlassDivider() }
                    StatsRow(item: item, today: today, round: round, owner: ownerOf(item), cache: cache) { onOpen(item) }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

private struct StatsRow: View {
    let item: StatItem
    let today: String
    let round: Bool
    let owner: UUID?
    let cache: StatsCoverCache
    let action: () -> Void

    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var rankWidth: CGFloat = 28

    private var stacked: Bool { typeSize.isAccessibilitySize }

    /// A track's title without its "(feat. ...)" (the names move to the artist line); other rows keep theirs.
    private var plainTitle: String {
        guard item.trackId != nil else { return item.title }
        let plain = ArtistNames.splitFeaturing(item.title).title
        return plain.isEmpty ? item.title : plain
    }

    /// Tracks and albums carry their artist as the subtitle: it becomes the linked artist line (#288).
    /// A track's line also holds the features from its title, merged with any in an "A feat. B" artist.
    private var artistCredit: (artist: String, featuring: [String])? {
        guard item.releaseId != nil, !item.subtitle.isEmpty else { return nil }
        let split = ArtistNames.splitArtistFeaturing(item.subtitle)
        let fromTitle = item.trackId != nil ? ArtistNames.splitFeaturing(item.title).featuring : []
        return (split.artist, FeaturingNames.merged(fromTitle, split.featuring))
    }

    /// The row opens the release through a button behind it; the artist links sit on top, so no
    /// link is nested in a Button. VoiceOver reads the row as one element, then the artist links.
    var body: some View {
        HStack(alignment: stacked ? .top : .center, spacing: 12) {
            Text("\(item.rank)")
                .font(.system(.subheadline, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(StatsStyle.rankColor(item.medal))
                .frame(width: min(rankWidth, 56))
                .accessibilityHidden(true)
            StatsCoverView(owner: owner, cache: cache, round: round)
                .frame(width: Theme.Stats.rowCover, height: Theme.Stats.rowCover)
                .shadow(color: .black.opacity(0.5), radius: 6, y: 4)
            VStack(alignment: .leading, spacing: 2) {
                Text(plainTitle)
                    .font(.system(.body, weight: .semibold))
                    .foregroundStyle(StatsStyle.nameColor(item.medal))
                    .lineLimit(stacked ? 4 : 1)
                    .accessibilityHidden(true)
                if let credit = artistCredit {
                    ArtistLineText(
                        main: credit.artist, featuring: credit.featuring, font: .subheadline,
                        mainColor: Theme.secondaryText, dimColor: Theme.secondaryText, lineLimit: stacked ? nil : 2
                    )
                } else {
                    Text(item.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(stacked ? 3 : 1)
                        .accessibilityHidden(true)
                }
                if stacked { numbers(alignment: .leading).padding(.top, 4).accessibilityHidden(true) }
            }
            if !stacked {
                Spacer(minLength: 8)
                numbers(alignment: .trailing).accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(minHeight: Theme.Stats.minTarget, alignment: .leading)
        .background {
            Button(action: action) { Color.clear.contentShape(Rectangle()) }
                .buttonStyle(SoftPressStyle())
                .accessibilityLabel(buttonLabel)
        }
    }

    private var buttonLabel: String {
        let base = Copy.Stats.itemLabel(rank: item.rank, title: plainTitle, plays: item.plays)
        let played = Copy.Stats.lastPlayedLabel(item.lastPlayedDay, today: today)
        return artistCredit == nil ? "\(base), \(item.subtitle), \(played)" : "\(base), \(played)"
    }

    private func numbers(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(Copy.Stats.playsCount(item.plays))
                .font(.system(.subheadline, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.primaryText)
            Text(Copy.Stats.lastPlayedLabel(item.lastPlayedDay, today: today))
                .font(.footnote)
                .foregroundStyle(Theme.secondaryText)
        }
    }
}

/// The sorted sea: covers in rank order, in three sizes that step down. Each size is its own grid;
/// the columns come from the room it has, so a tile is never under 72 pt.
struct StatsSea: View {
    let items: [StatItem]
    /// The room the grid has.
    let width: CGFloat
    let round: Bool
    let cache: StatsCoverCache
    let ownerOf: (StatItem) -> UUID?
    let label: String
    let onOpen: (StatItem) -> Void

    @Environment(\.dynamicTypeSize) private var typeSize

    private var columns: [Int] {
        let base = StatsSeaLayout.columns(forWidth: width)
        // Bigger text needs wider tiles for its names.
        return typeSize.isAccessibilitySize ? base.map { max(2, $0 - 1) } : base
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(Copy.Stats.gridHint)
                .font(.footnote)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 6)
            ForEach(Array(StatsSeaLayout.tiers(items).enumerated()), id: \.offset) { tier, group in
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: Theme.Stats.tileGap, alignment: .top), count: columns[tier]),
                    alignment: .leading, spacing: Theme.Stats.tileRowGap
                ) {
                    ForEach(group) { item in
                        StatsTile(item: item, tier: tier, round: round, owner: ownerOf(item), cache: cache) { onOpen(item) }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

private struct StatsTile: View {
    let item: StatItem
    let tier: Int
    let round: Bool
    let owner: UUID?
    let cache: StatsCoverCache
    let action: () -> Void

    @Environment(\.dynamicTypeSize) private var typeSize

    private var nameFont: Font {
        tier == 0 ? .system(.footnote, weight: .semibold) : .system(.caption, weight: .semibold)
    }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                StatsCoverView(owner: owner, cache: cache, round: round, cornerRadius: 4)
                    .aspectRatio(1, contentMode: .fit)
                    .overlay { chip("\(item.rank)", corner: .topLeading) }
                    .overlay { chip(tier == 2 ? Copy.Stats.formatCount(item.plays) : Copy.Stats.playsCount(item.plays), corner: .bottomTrailing) }
                    .shadow(color: .black.opacity(0.55), radius: 8, y: 6)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.title)
                        .font(nameFont)
                        .foregroundStyle(StatsStyle.nameColor(item.medal))
                        .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                    if tier == 0 {
                        Text(item.subtitle)
                            .font(.footnote)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(typeSize.isAccessibilitySize ? 2 : 1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Copy.Stats.itemLabel(rank: item.rank, title: item.title, plays: item.plays)), \(item.subtitle)")
    }

    /// The rank or the plays over a cover: white on a dark pill. On a round cover the chips sit
    /// inside the circle, a share in from the corner, as on the Mac.
    private func chip(_ text: String, corner: Alignment) -> some View {
        GeometryReader { geo in
            Text(text)
                .font(.system(size: 11, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .frame(minHeight: 20)
                .background(Capsule().fill(Color.black.opacity(0.68)))
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .padding(round ? geo.size.width * 0.09 : 6)
                .frame(width: geo.size.width, height: geo.size.height, alignment: corner)
        }
        .accessibilityHidden(true)
    }
}
