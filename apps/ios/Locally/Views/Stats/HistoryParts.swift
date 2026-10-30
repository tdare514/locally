import SwiftUI
import UIKit

// The pieces of the History screen (#399, the owner's variant B "Day strip and crate"): the sleeve with its disc
// peeking out, the device line, the minutes pill, the wash and the title. `HistoryView` lays them out and the DEBUG
// gallery shows the same view over fixture data.

extension Color {
    /// A blend toward `other` by `amount` (0 to 1); `Color.mix` needs iOS 18.
    func blended(with other: Color, by amount: CGFloat) -> Color {
        var a: (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        var b: (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        UIColor(self).getRed(&a.0, green: &a.1, blue: &a.2, alpha: &a.3)
        UIColor(other).getRed(&b.0, green: &b.1, blue: &b.2, alpha: &b.3)
        return Color(red: a.0 + (b.0 - a.0) * amount, green: a.1 + (b.1 - a.1) * amount, blue: a.2 + (b.2 - a.2) * amount)
    }
}

extension HistoryPlay {
    /// "iPhone", "Mac" or "Spotify (online)".
    var deviceLabel: String { isSpotify ? Copy.History.spotify : event.device.name }
    var deviceSymbol: String {
        if isSpotify { return "antenna.radiowaves.left.and.right" }
        return event.device.platform == "macos" ? "laptopcomputer" : "iphone"
    }
    /// Said in words as well as drawn by the disc, so the amount heard never rests on the picture alone.
    var heardText: String { isFullListen ? Copy.History.fullListen : Copy.History.heard(Copy.History.clock(ms: event.listenedMs)) }
    var timeText: String { Copy.History.time(event.started) }
    var displayTitle: String { title ?? Copy.History.unknownSong }
    var spoken: String {
        Copy.History.spoken(title: displayTitle, artist: artist, time: timeText, device: deviceLabel, heard: heardText)
    }
}

/// Covers and the wash colours for the releases on screen, read off the main thread and kept in memory.
@MainActor
@Observable
final class HistoryCovers {
    private(set) var images: [UUID: UIImage] = [:]
    private(set) var palettes: [UUID: AmbientPalette] = [:]
    @ObservationIgnored private let cache: StatsCoverCache
    @ObservationIgnored private var requested = Set<UUID>()

    init(cache: StatsCoverCache) { self.cache = cache }

    func tint(of id: UUID?) -> Color {
        id.flatMap { palettes[$0] }.map { ArtworkBackdrop.color(hex: $0.primary) } ?? .white
    }

    func palette(of id: UUID?) -> AmbientPalette { id.flatMap { palettes[$0] } ?? .neutral }

    func load(_ ids: Set<UUID>) async {
        for id in ids where requested.insert(id).inserted {
            let image = await cache.image(for: id)
            let data = await cache.data(for: id)
            let palette = await Task.detached(priority: .utility) { ArtworkPalette.palette(forCover: data) }.value
            if let image { images[id] = image }
            palettes[id] = palette
        }
    }
}

/// A cover sleeve whose disc shows past the edge in proportion to how much of the track was heard: a full listen shows
/// the most disc, a 30 s skip a sliver. The frame always reserves the full peek, so text lines up down a list.
struct HistorySleeve: View {
    let image: UIImage?
    let fraction: Double
    let side: CGFloat
    var radius = Theme.History.sleeveRadiusSmall

    var body: some View {
        let disc = side * Theme.Immersive.discToSleeveRatio
        let fullPeek = disc * Theme.Immersive.discPeekRatio
        let amount = Theme.History.minPeek + (1 - Theme.History.minPeek) * CGFloat(fraction)
        let shown = fullPeek * amount
        ZStack(alignment: .leading) {
            RecordDisc(cover: image, size: disc)
                .offset(x: side + shown - disc)
            cover
        }
        .frame(width: side + fullPeek, height: side, alignment: .leading)
        .accessibilityHidden(true)
    }

    private var cover: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Theme.card
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(LinearGradient(colors: [.white.opacity(Theme.History.sleeveEdgeOpacity), .clear], startPoint: .top, endPoint: .bottom), lineWidth: 1))
        .shadow(color: .black.opacity(Theme.History.sleeveShadowOpacity), radius: side * 0.08, x: 0, y: side * 0.05)
    }
}

/// The device and how much was heard, in one quiet line that wraps at large sizes.
struct HistoryDeviceLine: View {
    let play: HistoryPlay
    var showsHeard = true

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Image(systemName: play.deviceSymbol).imageScale(.small).accessibilityHidden(true)
            Text(showsHeard ? "\(play.deviceLabel) · \(play.heardText)" : play.deviceLabel)
        }
        .font(.footnote)
        .foregroundStyle(Theme.secondaryText)
    }
}

/// A minutes pill tinted by the cover; the words carry the meaning, the tint is only the finish.
struct HistoryMinutes: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.system(.subheadline, design: .rounded, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(tint.opacity(0.30), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.55), lineWidth: 1))
    }
}

struct HistoryBackdrop: View {
    let palette: AmbientPalette
    var body: some View {
        ZStack {
            Theme.background
            ArtworkBackdrop(palette: palette)
        }
        .ignoresSafeArea()
    }
}

struct HistoryTitle: View {
    var body: some View {
        Text(Copy.History.title)
            .font(.system(.largeTitle, weight: .bold))
            .foregroundStyle(.white)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The loading state: sleeve and text shapes in the crate's layout that breathe slowly; still under Reduce Motion.
struct HistorySkeleton: View {
    let columns: Int
    let side: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var lit = false

    var body: some View {
        let fill = Color.white.opacity(lit ? Theme.History.skeletonFillOpacity * 1.9 : Theme.History.skeletonFillOpacity)
        HStack(alignment: .top, spacing: Theme.History.crateGap) {
            ForEach(0..<columns, id: \.self) { column in
                VStack(alignment: .leading, spacing: Theme.History.crateRowGap) {
                    ForEach(0..<Theme.History.skeletonCells / columns, id: \.self) { _ in
                        VStack(alignment: .leading, spacing: 8) {
                            ZStack(alignment: .leading) {
                                Circle().fill(fill).frame(width: side * Theme.Immersive.discToSleeveRatio)
                                    .offset(x: side * 0.3)
                                // Opaque under the tint, so the disc shows only where it peeks past the sleeve.
                                RoundedRectangle(cornerRadius: Theme.History.sleeveRadiusLarge, style: .continuous)
                                    .fill(Theme.background)
                                    .overlay(RoundedRectangle(cornerRadius: Theme.History.sleeveRadiusLarge, style: .continuous).fill(fill))
                                    .frame(width: side, height: side)
                            }
                            Capsule().fill(fill).frame(width: side * 0.4, height: 12)
                            Capsule().fill(fill).frame(width: side * 0.8, height: 14)
                            Capsule().fill(fill).frame(width: side * 0.5, height: 12)
                        }
                    }
                }
                .padding(.top, column == 1 ? Theme.History.crateStagger : 0)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Copy.History.loadingLabel)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: Theme.History.skeletonSweepSeconds).repeatForever(autoreverses: true)) { lit = true }
        }
    }
}
