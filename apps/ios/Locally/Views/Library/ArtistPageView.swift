import SwiftUI

/// An artist's page (#288), opened from the Artists view or from any artist name. The cover wash of
/// their newest release sits behind it; the name is the page's one bold element with a dim count
/// line, then Albums, Singles, Appears on and Most played, each hidden when empty. Everything is read
/// from the library when the page appears; Most played reads all-time plays through the Stats
/// tab's `PlayStatsReading` (so its cache and request limits apply) and simply doesn't show when
/// signed out or offline.
struct ArtistPageView: View {
    let route: ArtistRoute

    @Environment(\.appContainer) private var container
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var catalog: ArtistCatalog?
    @State private var covers: ArtistCoverSource?
    @State private var plays: [UUID: Int] = [:]
    @State private var palette: AmbientPalette?
    @ScaledMetric(relativeTo: .largeTitle) private var titleSize: CGFloat = 30
    @ScaledMetric(relativeTo: .subheadline) private var lineSize: CGFloat = 14
    /// Row covers grow with the text, up to a size that still leaves room for the words.
    @ScaledMetric(relativeTo: .body) private var rowCover: CGFloat = 40

    private static let sectionFont = Font.system(.headline, weight: .bold)
    private static let metaFont = Font.subheadline
    private static let rowTitleFont = Font.system(.subheadline, weight: .semibold)

    private var entry: ArtistCatalogEntry? { catalog?.entry(forKey: route.key) }
    private var stacked: Bool { dynamicTypeSize.isAccessibilitySize }

    private struct PaletteKey: Hashable {
        let id: UUID
        let updatedAt: Date
    }

    private var paletteKey: PaletteKey? {
        entry?.newest.map { PaletteKey(id: $0.id, updatedAt: $0.updatedAt) }
    }

    var body: some View {
        ZStack {
            backdrop
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let entry, let covers {
                        page(entry, covers: covers)
                    } else if catalog != nil {
                        gone
                    }
                }
                .padding(.horizontal, Theme.Spacing.listPagePadding)
                .padding(.top, 12)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        // `.onAppear` (not `.task`) so coming back from a release page re-reads the library.
        .onAppear(perform: load)
        .task(id: route) { await loadPlays() }
        .task(id: paletteKey) { await loadPalette() }
    }

    // MARK: Backdrop

    @ViewBuilder
    private var backdrop: some View {
        ZStack {
            ArtworkBackdrop(palette: palette ?? .neutral)
            // The Stats page's scrim: it keeps the greys at 4.5:1 on the brightest wash a pale cover gives.
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.5), location: 0),
                    .init(color: .black.opacity(0.3), location: 0.45),
                    .init(color: .black.opacity(0), location: 0.9),
                ],
                startPoint: .top, endPoint: .bottom
            )
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .ignoresSafeArea()
    }

    // MARK: Content

    @ViewBuilder
    private func page(_ entry: ArtistCatalogEntry, covers: ArtistCoverSource) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(entry.name)
                .font(.system(size: titleSize, weight: .bold))
                .foregroundStyle(Theme.primaryText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("artist-page-title")
            Text(Copy.Artists.pageLine(albums: entry.albums.count, singles: entry.singles.count, appearsOn: entry.appearsOn.count))
                .font(.system(size: lineSize))
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        if !entry.albums.isEmpty {
            section(Copy.Artists.albumsSection, count: entry.albums.count) { tiles(entry.albums, covers: covers) }
        }
        if !entry.singles.isEmpty {
            section(Copy.Artists.singlesSection, count: entry.singles.count) { tiles(entry.singles, covers: covers) }
        }
        if !entry.appearsOn.isEmpty {
            section(Copy.Artists.appearsOnSection, count: entry.appearsOn.count) {
                panel(entry.appearsOn.map { appearance in
                    row(
                        rank: nil, release: appearance.release, track: appearance.track, covers: covers,
                        detail: Copy.Artists.releaseLine(title: appearance.release.title, year: appearance.release.year), plays: nil
                    )
                    .id(appearance.track.id)
                })
            }
        }
        let played = catalog?.mostPlayed(forKey: route.key, plays: plays) ?? []
        if !played.isEmpty {
            section(Copy.Artists.mostPlayedSection, count: played.count) {
                panel(played.enumerated().map { index, item in
                    row(
                        rank: index + 1, release: item.release, track: item.track, covers: covers,
                        detail: nil, plays: Copy.Detail.playCount(item.plays)
                    )
                    .id(item.track.id)
                })
            }
        }
    }

    private func section<Content: View>(_ label: String, count: Int, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                    .font(Self.sectionFont)
                    .foregroundStyle(Theme.primaryText)
                Text(Copy.Artists.sectionCount(count))
                    .font(Self.metaFont)
                    .foregroundStyle(Theme.textDim)
                Spacer()
            }
            .padding(.horizontal, 4)
            .frame(minHeight: Theme.Library.sectionHeaderMinHeight)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            content()
        }
    }

    // MARK: Albums and Singles

    /// The library Grid's medium tiles: cover, title, year under it. At the accessibility sizes one
    /// full-width column, so a title has room to wrap without breaking a word.
    private func tiles(_ releases: [Release], covers: ArtistCoverSource) -> some View {
        LazyVGrid(
            columns: stacked
                ? [GridItem(.flexible())]
                : [GridItem(.adaptive(minimum: CoverSize.large.tileMinWidth), spacing: CoverSize.large.tileGap)],
            spacing: CoverSize.large.tileGap
        ) {
            ForEach(releases) { release in
                NavigationLink(value: release) {
                    VStack(alignment: .leading, spacing: Theme.Library.tileTextGap) {
                        Color.clear
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                StatsCoverView(owner: release.id, cache: covers.cache, cornerRadius: Theme.Library.tileCornerRadius)
                                    .id(covers.generation)
                            }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(release.title)
                                .font(Self.rowTitleFont)
                                .foregroundStyle(Theme.primaryText)
                                .lineLimit(stacked ? nil : 1)
                            if let year = release.year, !year.isEmpty {
                                Text(year)
                                    .font(Self.metaFont)
                                    .foregroundStyle(Theme.secondaryText)
                                    .lineLimit(stacked ? nil : 1)
                            }
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressAwareStyle(rowHighlight: false, onPress: {}))
            }
        }
    }

    // MARK: Track rows

    private func panel(_ rows: [some View]) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Library.listPanelCornerRadius, style: .continuous)
        return VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, view in
                view
                if index < rows.count - 1 {
                    Rectangle().fill(Theme.Immersive.panelStroke).frame(height: 1)
                }
            }
        }
        .background(shape.fill(Theme.Immersive.panelFill))
        .clipShape(shape)
        .overlay(shape.stroke(Theme.Immersive.panelStroke, lineWidth: 1))
    }

    /// One track: a small cover, the plain title (it opens the release), the artist line with a link
    /// on every name, then the release and year (Appears on) or the plays (Most played).
    private func row(rank: Int?, release: Release, track: Track, covers: ArtistCoverSource, detail: String?, plays: String?) -> some View {
        let credit = ArtistCatalog.credit(of: track, in: release)
        let title = ArtistCatalog.plainTitle(track)
        return HStack(alignment: stacked ? .top : .center, spacing: 12) {
            if let rank {
                Text("\(rank)")
                    .font(.system(.subheadline, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.secondaryText)
                    .frame(minWidth: 18)
                    .accessibilityHidden(true)
            }
            StatsCoverView(owner: release.id, cache: covers.cache, cornerRadius: 6)
                .id(covers.generation)
                .frame(width: min(rowCover, 64), height: min(rowCover, 64))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Self.rowTitleFont)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(stacked ? nil : 2)
                    .accessibilityHidden(true)
                ArtistLineText(main: credit.main, featuring: credit.featuring, font: .footnote)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(Theme.textHint)
                        .lineLimit(stacked ? nil : 1)
                        .accessibilityHidden(true)
                }
                if stacked, let plays { playsText(plays) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !stacked, let plays { playsText(plays) }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(minHeight: 64)
        .background {
            // The row opens the release; the artist links above it take their own taps.
            NavigationLink(value: release) { Color.clear.contentShape(Rectangle()) }
                .buttonStyle(PressAwareStyle(rowHighlight: true, onPress: {}))
                .accessibilityLabel([rank.map(Copy.Artists.rankLabel), title, detail, plays].compactMap { $0 }.joined(separator: ", "))
        }
    }

    private func playsText(_ text: String) -> some View {
        Text(text)
            .font(.system(.subheadline, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(Theme.primaryText)
            .accessibilityHidden(true)
    }

    // MARK: Gone

    private var gone: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(Copy.Artists.gone)
                .font(Self.sectionFont)
                .foregroundStyle(Theme.primaryText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Button(Copy.Artists.backToLibrary) { dismiss() }
                .buttonStyle(TextButtonStyle())
                .frame(minHeight: Theme.Spacing.minTarget)
        }
        .padding(.top, 24)
    }

    // MARK: Loading

    private func load() {
        guard let container else { return }
        let releases = (try? container.library.all()) ?? []
        let store = container.coverStore
        let source = covers ?? ArtistCoverSource(loader: { store.load($0) })
        source.refresh(releases)
        covers = source
        catalog = ArtistCatalog(releases: releases)
    }

    /// All-time plays by track id, from the same read (and cache) the Stats tab's All time uses.
    private func loadPlays() async {
        guard let container else { return }
        let calendar = Calendar.current
        let today = PlayPeriods.localDayString(Date(), calendar: calendar)
        let firstDay = PlayPeriods.isoFirstDay(fromAppleFirstWeekday: calendar.firstWeekday)
        let range = PlayPeriods.selectionRange(PeriodSelection(kind: .all, back: 0), today: today, firstDay: firstDay)
        guard case .ok(let summary) = await container.playStats.summary(from: range.from, to: range.to, force: false) else {
            plays = [:]
            return
        }
        var byTrack: [UUID: Int] = [:]
        for count in summary.allTime {
            if let id = UUID(uuidString: count.trackId) { byTrack[id] = max(byTrack[id] ?? 0, count.plays) }
        }
        plays = byTrack
    }

    private func loadPalette() async {
        guard let container, let release = entry?.newest else { palette = nil; return }
        let store = container.coverStore
        let id = release.id
        palette = await Task.detached(priority: .utility) {
            ArtworkPalette.palette(forCover: store.load(id))
        }.value
    }
}
