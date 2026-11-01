import SwiftUI

/// The three cards under "All music" (#446): This week (the week's plays and how many tracks they were of),
/// Most played (the week's top track) and Top artist (a round avatar from the artist's newest cover). Each is one
/// button with one spoken label. Equal width in a row; at accessibility text sizes they stack as full-width rows.
/// Cards are `panelFill` on a `panelStroke` hairline at radius 12: no glow, tint or shadow, and no medals (rank is the
/// word on the card). `isPlaceholder` draws the same views as still shapes with their content hidden but measured, which
/// is how `LibraryHeaderCardsPlaceholder` keeps to the loaded cards' size at every text size.
struct LibraryHeaderCards: View {
    let week: LibraryWeek
    /// The release Most played opens, and the one whose cover draws the artist's avatar.
    let trackRelease: Release?
    let artistRelease: Release?
    let coverCache: LibraryCoverCache?
    let coverGeneration: Int
    var onThisWeek: () -> Void
    var onTrack: () -> Void
    var onArtist: () -> Void
    /// Skeleton fill, content hidden but still taking its space, nothing to press.
    var isPlaceholder = false

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.displayScale) private var displayScale
    @ScaledMetric(relativeTo: .title2) private var bigNumberSize: CGFloat = 26
    @ScaledMetric(relativeTo: .body) private var scaledMinHeight = Theme.Library.headerCardMinHeight
    @ScaledMetric(relativeTo: .body) private var coverSide = Theme.Library.headerCardCover

    private var stacked: Bool { dynamicTypeSize.isAccessibilitySize }
    /// Grows with the text, but stops short of a card that is mostly empty (the stacked rows at the largest sizes).
    private var cardMinHeight: CGFloat { min(scaledMinHeight, Theme.Library.headerCardMaxMinHeight) }

    var body: some View {
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Library.headerCardGap))
            : AnyLayout(HStackLayout(alignment: .top, spacing: Theme.Library.headerCardGap))
        layout {
            thisWeekCard
            mostPlayedCard
            topArtistCard
        }
        // Equal heights across the row.
        .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Cards

    private var thisWeekCard: some View {
        card(label: Copy.Library.thisWeek, spoken: Copy.Library.thisWeekLabel(plays: week.total, tracks: week.trackCount), hint: Copy.Library.thisWeekHint, action: onThisWeek) {
            Text("\(week.total)")
                .font(.system(size: bigNumberSize, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Theme.primaryText)
            Text(Copy.Library.playsWord)
                .themeFont(.meta)
                .foregroundStyle(Theme.secondaryText)
            Spacer(minLength: 4)
            Text(Copy.Library.acrossTracks(week.trackCount))
                .themeFont(.dropZoneHint)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(stacked ? nil : 1)
                .minimumScaleFactor(0.7)
        }
    }

    private var mostPlayedCard: some View {
        card(
            label: Copy.Library.mostPlayed, spoken: Copy.Library.mostPlayedLabel(title: week.topTrack.title, plays: week.topTrack.plays),
            hint: Copy.Library.mostPlayedHint, action: onTrack
        ) {
            cover(of: trackRelease, radius: Theme.Radius.thumbnail)
            nameAndPlays(week.topTrack)
        }
    }

    private var topArtistCard: some View {
        card(
            label: Copy.Library.topArtist, spoken: Copy.Library.topArtistLabel(name: week.topArtist.title, plays: week.topArtist.plays),
            hint: Copy.Library.topArtistHint, action: onArtist
        ) {
            cover(of: artistRelease, radius: coverSide / 2)
            nameAndPlays(week.topArtist)
        }
    }

    private func nameAndPlays(_ item: StatItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(item.title)
                .themeFont(.rowTitle)
                .foregroundStyle(Theme.primaryText)
                .lineLimit(stacked ? nil : 1)
            Text(Copy.Library.plays(item.plays))
                .themeFont(.meta)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
        }
    }

    /// The card's shell: its label in the corner, then whatever it shows, in one button.
    private func card<Content: View>(
        label: String, spoken: String, hint: String, action: @escaping () -> Void, @ViewBuilder content: () -> Content
    ) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
        return Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .themeFont(.dropZoneHint)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                content()
            }
            .opacity(isPlaceholder ? 0 : 1)
            .padding(Theme.Library.headerCardPadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .frame(minHeight: cardMinHeight)
            .background(shape.fill(isPlaceholder ? Theme.skeletonFill : Theme.Immersive.panelFill))
            .overlay(shape.stroke(Theme.Immersive.panelStroke, lineWidth: 1))
            .contentShape(shape)
        }
        .buttonStyle(LibraryCardStyle())
        .allowsHitTesting(!isPlaceholder)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(spoken)
        .accessibilityHint(hint)
    }

    /// A cover (or the avatar) from the Library's bounded cover cache; the note on `card` when there is none.
    @ViewBuilder
    private func cover(of release: Release?, radius: CGFloat) -> some View {
        Group {
            if let release, let coverCache {
                LibraryCoverView(
                    id: release.id, updatedAt: release.updatedAt, pixels: coverSide * displayScale, cache: coverCache,
                    cornerRadius: radius, generation: coverGeneration
                )
            } else {
                NoCoverArt().clipShape(.rect(cornerRadius: radius))
            }
        }
        .frame(width: coverSide, height: coverSide)
        .accessibilityHidden(true)
    }
}

/// A card pressed: a little less opacity, nothing else (design rule 2: a state is a change of fill or opacity).
private struct LibraryCardStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// The cards' place while the week is read: the loaded cards' own views (a three-digit figure, a two-line title, a
/// cover box of the real size) as still shapes with the content hidden, shown after 300 ms (docs/design.md rule 10).
/// They are the same size as the loaded cards at every text size because they are the same layout.
struct LibraryHeaderCardsPlaceholder: View {
    var body: some View {
        DelayedSkeleton(label: Copy.Library.weekLoading) {
            LibraryHeaderCards(
                week: .sample, trackRelease: nil, artistRelease: nil, coverCache: nil, coverGeneration: 0,
                onThisWeek: {}, onTrack: {}, onArtist: {}, isPlaceholder: true
            )
        }
    }
}

private extension LibraryWeek {
    /// What the placeholder lays out: never seen, only measured.
    static let sample = LibraryWeek(
        total: 888, trackCount: 88, topTrack: item("Sample title\nSample title"), topArtist: item("Sample artist\nSample artist"),
        artistKey: "sample"
    )

    private static func item(_ title: String) -> StatItem {
        StatItem(
            id: "sample", rank: 1, title: title, subtitle: "", plays: 88, lastPlayedDay: nil, releaseId: nil, trackId: nil,
            coverPath: nil, medal: nil
        )
    }
}
