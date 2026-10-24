import SwiftUI

/// The Collections card at the top of the Library (#360): one glass button that pushes the Collections
/// screen, washed with the first collection's cover colours, with the first collections' covers stacked at its
/// left like record sleeves (the front one with a vinyl peeking out), then "Collections", the count and a chevron. With no collections it still opens the screen,
/// with the plan's line under the title. ("New collection" lives on the Collections screen.)
struct CollectionsLibraryCard: View {
    let model: CollectionsModel
    var onOpen: () -> Void
    /// Draws the pressed look without a touch (the component gallery's frame).
    var posedPressed = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.appContainer) private var container
    /// The first collection's cover colours, read off the main thread; nil with no cover.
    @State private var palette: AmbientPalette?

    private var firstCoverID: UUID? { model.collections.first.flatMap { model.coverReleaseIDs(of: $0).first } }

    /// Holds the card's place while the collections model is made, so the Library header does not pop in.
    static var placeholder: some View {
        CardGlass(palette: nil)
            .frame(maxWidth: .infinity, minHeight: Theme.Library.collectionsCardMinHeight)
            .accessibilityHidden(true)
    }

    var body: some View {
        if let failure = model.readFailure {
            // Not "no collections": the store could not be read.
            ReadFailureView(message: failure, compact: true) { model.reload() }
        } else if !model.isLoaded {
            Self.placeholder
        } else {
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
                .background(CardGlass(palette: palette))
                .contentShape(RoundedRectangle(cornerRadius: Theme.Library.collectionsCardRadius, style: .continuous))
            }
            .buttonStyle(CardPressStyle(posed: posedPressed))
            .task(id: firstCoverID) {
                guard let id = firstCoverID, let store = container?.coverStore else { palette = nil; return }
                palette = await Task.detached(priority: .utility) { ArtworkPalette.palette(forCover: store.load(id)) }.value
            }
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel(model.collections.isEmpty ? Copy.Collections.title : "\(Copy.Collections.title), \(subtitle)")
            .accessibilityHint(Copy.Collections.libraryRowHint)
        }
    }

    private var subtitle: String {
        model.collections.isEmpty ? Copy.Collections.emptyLine : Copy.Collections.countLine(model.collections.count)
    }

    /// The first three collections as a stack of sleeves, the first in front with a vinyl peeking from its right
    /// edge; the two behind tilt -7 and +5 degrees with a soft shadow. Static.
    private var sleeves: some View {
        let shown = Array(model.collections.prefix(3))
        let side = Theme.Library.collectionsCardSleeve
        let step = Theme.Library.collectionsCardSleeveStep
        let tilts = Theme.Library.collectionsCardBackTilts
        let colors = Theme.coverGlowColors(palette == .neutral ? nil : palette)
        return ZStack(alignment: .leading) {
            ForEach(Array(shown.enumerated().dropFirst().reversed()), id: \.element.id) { index, collection in
                CollectionCoverView(releaseIDs: model.coverReleaseIDs(of: collection), side: side)
                    .shadow(color: .black.opacity(0.4), radius: 5, y: 3)
                    .rotationEffect(.degrees(tilts[min(index - 1, tilts.count - 1)]))
                    .offset(x: step * CGFloat(index))
            }
            vinyl(side: side, label: colors)
            CollectionCoverView(releaseIDs: shown.first.map { model.coverReleaseIDs(of: $0) } ?? [], side: side)
                .shadow(color: .black.opacity(0.4), radius: 5, y: 3)
        }
        .frame(width: side + Theme.Library.collectionsCardDiscPeek, height: side + 8, alignment: .leading)
        .accessibilityHidden(true)
    }

    /// A black disc with faint grooves and a centre label in the cover's colour, mostly behind the front sleeve.
    private func vinyl(side: CGFloat, label: [Color]) -> some View {
        let disc = side * Theme.Library.collectionsCardDiscRatio
        return ZStack {
            Circle().fill(Color.black)
            ForEach([0.78, 0.6, 0.46], id: \.self) { ratio in
                Circle().strokeBorder(Color.white.opacity(0.08), lineWidth: 0.75).frame(width: disc * ratio, height: disc * ratio)
            }
            Circle().fill(LinearGradient(colors: label, startPoint: .topLeading, endPoint: .bottomTrailing)).frame(width: disc * 0.36, height: disc * 0.36)
            Circle().fill(Color.black).frame(width: disc * 0.06, height: disc * 0.06)
        }
        .overlay(Circle().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.75))
        .frame(width: disc, height: disc)
        .shadow(color: .black.opacity(0.4), radius: 4, y: 2)
        .offset(x: side + Theme.Library.collectionsCardDiscPeek - disc)
    }
}

/// Faked glass for the card: the cover's colour washing in from the leading edge, the panel glass and a rim
/// (brighter along the top) on the card's rounded rectangle, and a soft drop shadow.
private struct CardGlass: View {
    let palette: AmbientPalette?

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Library.collectionsCardRadius, style: .continuous)
        let wash = ArtworkBackdrop.color(hex: (palette ?? .neutral).primary)
        return ZStack {
            shape.fill(LinearGradient(
                colors: [wash.opacity(Theme.Library.collectionsCardWashOpacity), .clear],
                startPoint: .leading,
                endPoint: UnitPoint(x: Theme.Library.collectionsCardWashEnd, y: 0.5)
            ))
            GlowGlass().clipShape(shape)
            shape.strokeBorder(
                LinearGradient(
                    stops: [
                        .init(color: .white.opacity(Theme.Import.glowRimTop), location: 0),
                        .init(color: .white.opacity(Theme.Import.glowRim), location: 0.4),
                        .init(color: .white.opacity(Theme.Import.glowRim), location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                ),
                lineWidth: 1
            )
        }
        .shadow(color: .black.opacity(0.3), radius: 10, y: 4)
    }
}

/// The pressed card: 0.98 scale and a little less opacity on the house easing over 0.2 s. With Reduce Motion
/// only the opacity changes.
private struct CardPressStyle: ButtonStyle {
    var posed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed || posed
        configuration.label
            .scaleEffect(pressed && !reduceMotion ? Theme.Library.collectionsCardPressScale : 1)
            .opacity(pressed ? Theme.Library.collectionsCardPressOpacity : 1)
            .animation(.timingCurve(0.16, 1, 0.3, 1, duration: Theme.Library.collectionsCardPressDuration), value: pressed)
    }
}
