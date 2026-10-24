#if DEBUG
import Observation
import SwiftUI

// #366 prototype: two ways to build a collection, over the gallery's sample library. Nothing here ships.
// 1 "One screen": the sleeve, its name, the picks strip, search and the library on one page.
// 1b "One screen, sleek": variant 1's page with no boxes: one wash, a releases shelf, a borderless list, a floating bar.
// 2 "Name, then pick": a naming moment, then the picker as a sheet.
// Both reuse the app's own parts: RecordSleeve, ArtworkBackdrop, GlowGlass/GlowRim, GlowSwitch,
// CoverGlowButtonStyle, LibrarySearch, ArtworkPalette.

// MARK: - Sample library

/// The seeded sample releases (one of them adopted, details only) and their covers.
struct BuilderLibrary {
    let releases: [Release]
    let images: [UUID: UIImage]
    let data: [UUID: Data]

    static let adopted = Release(
        id: UUID(uuidString: "00000000-0000-0000-0000-0000000000a1")!, kind: .album, title: "Harbour Sessions", artist: "Okoro",
        coverPath: "/cover/3.png", folderPath: "/mac", tracks: [
            Track(title: "Low Light", trackNumber: 1, filePath: "", originalName: "", durationSec: 241),
            Track(title: "Fog Horn", trackNumber: 2, filePath: "", originalName: "", durationSec: 198),
        ], source: .adopted)

    static let sample: BuilderLibrary = {
        let sampleReleases = StatsGallery.releases
        var data = StatsGallery.covers
        data[adopted.id] = data[sampleReleases[2].id]
        let images = data.compactMapValues { UIImage(data: $0) }
        return BuilderLibrary(releases: sampleReleases + [adopted], images: images, data: data)
    }()

    func release(_ id: UUID) -> Release? { releases.first { $0.id == id } }
}

/// One thing a tap adds: a whole release, or one song of it.
struct BuilderPick: Hashable {
    let releaseID: UUID
    var trackID: UUID?

    var item: CollectionItem {
        trackID.map { .track(releaseId: releaseID, trackId: $0) } ?? .release(releaseID)
    }
}

enum BuilderTab: Hashable { case songs, releases }

enum BuilderRowState { case off, on, viaRelease, existing }

// MARK: - Draft

/// What the builder holds while it grows: the name, the picks in order, the search and the sleeve's art.
@MainActor
@Observable
final class BuilderDraft {
    let isNew: Bool
    let library: BuilderLibrary
    /// What an existing collection already holds ("Add music").
    let existing: [BuilderPick]
    var name: String
    var query = ""
    var tab: BuilderTab = .songs
    private(set) var picks: [BuilderPick] = []
    private(set) var mosaic: UIImage?
    private(set) var palette: AmbientPalette?

    init(library: BuilderLibrary = .sample, name: String = "", existing: [BuilderPick]? = nil, picks: [BuilderPick] = []) {
        self.library = library
        self.isNew = existing == nil
        self.existing = existing ?? []
        self.name = name
        self.picks = picks
        refresh()
    }

    // Reading

    var glow: [Color] { Theme.coverGlowColors(palette) }
    var tint: Color { glow.first ?? Theme.accent }

    func state(of pick: BuilderPick) -> BuilderRowState {
        let whole = BuilderPick(releaseID: pick.releaseID, trackID: nil)
        if existing.contains(pick) || (pick.trackID != nil && existing.contains(whole)) { return .existing }
        if picks.contains(pick) { return .on }
        if pick.trackID != nil, picks.contains(whole) { return .viaRelease }
        return .off
    }

    private func songs(in pick: BuilderPick) -> [Track] {
        guard let release = library.release(pick.releaseID) else { return [] }
        if let trackID = pick.trackID { return release.tracks.filter { $0.id == trackID } }
        return release.tracks
    }

    var songCount: Int { picks.reduce(0) { $0 + songs(in: $1).count } }

    /// Seconds of the picked songs this phone holds (an adopted song plays on the Mac).
    var seconds: Double {
        picks.reduce(0) { total, pick in
            guard library.release(pick.releaseID)?.source != .adopted else { return total }
            return total + songs(in: pick).compactMap(\.durationSec).reduce(0, +)
        }
    }

    var summary: String {
        guard songCount > 0 else { return Copy.CollectionBuilder.nothingPicked }
        let count = isNew ? Copy.CollectionBuilder.songCount(songCount) : Copy.CollectionBuilder.newSongCount(songCount)
        return Copy.CollectionBuilder.summary(count, seconds: seconds)
    }

    var releaseMatches: [Release] { LibrarySearch.filter(library.releases, query: query) }

    /// Songs whose title or artist contains every word of the query.
    var songMatches: [(release: Release, track: Track)] {
        let tokens = LibrarySearch.normalize(query).split(separator: " ").map(String.init)
        return library.releases.flatMap { release in
            release.tracks.compactMap { track -> (Release, Track)? in
                let haystack = LibrarySearch.normalize("\(track.title) \(release.artist)")
                return tokens.allSatisfy { haystack.contains($0) } ? (release, track) : nil
            }
        }
    }

    // Editing

    func toggle(_ pick: BuilderPick) {
        switch state(of: pick) {
        case .existing, .viaRelease: return
        case .on: picks.removeAll { $0 == pick }
        case .off:
            // A whole release takes over any of its songs picked one by one.
            if pick.trackID == nil { picks.removeAll { $0.releaseID == pick.releaseID } }
            picks.append(pick)
        }
        refresh()
    }

    /// The sleeve's art: the first covers among what the collection holds and what is picked.
    private func refresh() {
        var ids: [UUID] = []
        for pick in existing + picks where !ids.contains(pick.releaseID) && library.images[pick.releaseID] != nil {
            ids.append(pick.releaseID)
            if ids.count == 4 { break }
        }
        mosaic = BuilderMosaic.image(ids.compactMap { library.images[$0] })
        palette = ids.first.map { ArtworkPalette.palette(forCover: library.data[$0]) }
    }
}

/// Up to four covers as one square: one whole, two halves, one tall and two stacked, or a 2x2.
enum BuilderMosaic {
    static func image(_ covers: [UIImage]) -> UIImage? {
        guard !covers.isEmpty else { return nil }
        let side = Theme.Builder.mosaicSide
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { context in
            let half = side / 2
            let rects: [CGRect]
            switch covers.count {
            case 1: rects = [CGRect(x: 0, y: 0, width: side, height: side)]
            case 2: rects = [CGRect(x: 0, y: 0, width: half, height: side), CGRect(x: half, y: 0, width: half, height: side)]
            case 3: rects = [CGRect(x: 0, y: 0, width: half, height: side), CGRect(x: half, y: 0, width: half, height: half), CGRect(x: half, y: half, width: half, height: half)]
            default: rects = [CGRect(x: 0, y: 0, width: half, height: half), CGRect(x: half, y: 0, width: half, height: half), CGRect(x: 0, y: half, width: half, height: half), CGRect(x: half, y: half, width: half, height: half)]
            }
            for (image, rect) in zip(covers, rects) {
                context.cgContext.saveGState()
                context.cgContext.clip(to: rect)
                let scale = max(rect.width / image.size.width, rect.height / image.size.height)
                let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                image.draw(in: CGRect(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width, height: size.height))
                context.cgContext.restoreGState()
                // A hairline between tiles, like the cover grid.
                context.cgContext.setStrokeColor(UIColor.black.withAlphaComponent(0.35).cgColor)
                context.cgContext.stroke(rect, width: 2)
            }
        }
    }
}

// MARK: - Parts

/// The cover's wash, or a quiet violet and blue until there is a cover.
private struct BuilderBackdrop: View {
    let draft: BuilderDraft

    var body: some View {
        ZStack {
            Theme.background
            ArtworkBackdrop(palette: draft.palette ?? AmbientPalette(primary: "#3b2a7a", secondary: "#143a78", deep: "#080a1c"))
        }
        .ignoresSafeArea()
    }
}

/// A cover square, or the double note when the release has no art.
private struct BuilderThumb: View {
    let image: UIImage?
    var side: CGFloat = Theme.Builder.thumb

    var body: some View {
        Color.clear
            .frame(width: side, height: side)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    NoCoverArt()
                }
            }
            .clipShape(.rect(cornerRadius: 10, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// The record sleeve with the collection's name typed on it.
private struct BuilderSleeve: View {
    let draft: BuilderDraft
    let size: CGFloat
    var autofocus = false

    @FocusState private var focused: Bool

    private var hasArt: Bool { draft.mosaic != nil }

    var body: some View {
        @Bindable var draft = draft
        ZStack(alignment: .leading) {
            RecordSleeve(cover: draft.mosaic, size: size, showsAddCaption: false) {}
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            ZStack(alignment: .bottom) {
                LinearGradient(colors: [.clear, .black.opacity(hasArt ? 0.8 : 0)], startPoint: .center, endPoint: .bottom)
                nameText
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .foregroundStyle(Color.white)
                    .multilineTextAlignment(.center)
                    .shadow(color: .black.opacity(hasArt ? 0.6 : 0), radius: 6, y: 1)
                    .padding(14)
            }
            .frame(width: size, height: size)
            .clipShape(.rect(cornerRadius: Theme.Immersive.sleeveCornerRadius, style: .continuous))
        }
        .frame(maxWidth: .infinity)
        .onAppear { if autofocus && draft.isNew { focused = true } }
    }

    @ViewBuilder
    private var nameText: some View {
        @Bindable var draft = draft
        if draft.isNew {
            TextField("", text: $draft.name, prompt: Text(Copy.CollectionBuilder.namePlaceholder).foregroundColor(.white.opacity(0.62)), axis: .vertical)
                .lineLimit(1...3)
                .focused($focused)
                .submitLabel(.done)
                .onChange(of: draft.name) { _, value in
                    if value.contains(where: \.isNewline) {
                        draft.name = String(value.filter { !$0.isNewline })
                        focused = false
                    }
                }
        } else {
            Text(draft.name)
        }
    }
}

/// The picks as small sleeves leaning in a crate, newest in front.
private struct BuilderStrip: View {
    let draft: BuilderDraft

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let tilt: [Double] = [-4, 2, -2, 3, -3, 1]
    private static let shown = 5

    var body: some View {
        let picks = Array(draft.picks.prefix(Self.shown))
        let extra = draft.picks.count - picks.count
        HStack(spacing: -Theme.Builder.stripOverlap) {
            if picks.isEmpty {
                ForEach(0..<3, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.28), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                        .frame(width: Theme.Builder.stripThumb, height: Theme.Builder.stripThumb)
                        .rotationEffect(.degrees(Self.tilt[index]))
                }
            }
            ForEach(Array(picks.enumerated()), id: \.element) { index, pick in
                BuilderThumb(image: draft.library.images[pick.releaseID], side: Theme.Builder.stripThumb)
                    .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.white.opacity(0.3), lineWidth: 1) }
                    .shadow(color: .black.opacity(0.5), radius: 6, x: 3, y: 2)
                    .rotationEffect(.degrees(Self.tilt[index % Self.tilt.count]))
                    .zIndex(Double(index))
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.5).combined(with: .opacity))
            }
            if extra > 0 {
                Text("+\(extra)")
                    .font(Theme.ScaledFont.pill)
                    .foregroundStyle(Theme.primaryText)
                    .frame(width: Theme.Builder.stripThumb, height: Theme.Builder.stripThumb)
                    .background { GlowGlass().clipShape(.rect(cornerRadius: 10, style: .continuous)) }
                    .zIndex(Double(Self.shown))
            }
        }
        .padding(.leading, 4)
        .padding(.vertical, 6)
        .animation(reduceMotion ? .easeOut(duration: 0.2) : Theme.Builder.ease, value: draft.picks)
        .accessibilityHidden(true)
    }
}

/// The strip on the left and "3 songs · 11 min" on the right; stacked at large text.
private struct BuilderPicksBar: View {
    let draft: BuilderDraft

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                BuilderStrip(draft: draft)
                Spacer(minLength: 0)
                summary.multilineTextAlignment(.trailing)
            }
            VStack(alignment: .leading, spacing: 4) {
                BuilderStrip(draft: draft)
                summary
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summary: some View {
        Text(draft.summary)
            .font(Theme.ScaledFont.subheadline)
            .foregroundStyle(draft.songCount > 0 ? Theme.primaryText : Theme.secondaryText)
            .contentTransition(.numericText())
            .animation(Theme.Builder.ease, value: draft.songCount)
            .accessibilityLabel(draft.summary)
    }
}

/// A glass search box (the Glow pill's glass and rim).
private struct BuilderSearchBox: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.secondaryText)
                .accessibilityHidden(true)
            TextField("", text: $text, prompt: Text(Copy.CollectionBuilder.searchPlaceholder).foregroundColor(Theme.secondaryText))
                .font(Theme.ScaledFont.input)
                .foregroundStyle(Theme.primaryText)
                .submitLabel(.search)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.secondaryText)
                        .frame(width: Theme.Builder.control, height: Theme.Builder.control)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Copy.CollectionBuilder.clearSearch)
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, text.isEmpty ? 16 : 4)
        .frame(minHeight: 48)
        .background { ZStack { Color.black.opacity(0.35); GlowGlass() }.clipShape(Capsule()) }
        .overlay { GlowRim() }
    }
}

/// A cover-tinted glass check (or, off, a plus) in a round control.
private struct BuilderCheck: View {
    let tint: Color
    let on: Bool
    var dimmed = false

    var body: some View {
        ZStack {
            Circle().fill(Color.black.opacity(0.35))
            Circle().fill(tint.opacity(on ? 0.9 : 0))
            GlowGlass().clipShape(Circle())
            Image(systemName: on ? "checkmark" : "plus")
                .font(.system(.body, weight: .bold))
                .foregroundStyle(Color.white)
        }
        .overlay { GlowRim(round: true) }
        .frame(width: Theme.Builder.control, height: Theme.Builder.control)
        .opacity(dimmed ? 0.45 : 1)
        .accessibilityHidden(true)
    }
}

private struct BuilderRowStyle: ButtonStyle {
    let tint: Color
    let selected: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Builder.rowRadius, style: .continuous)
        configuration.label
            .background {
                shape.fill(Color.black.opacity(0.28))
                    .overlay(shape.fill(Theme.Immersive.panelFill))
                    .overlay(shape.fill(tint.opacity(selected ? 0.3 : 0)))
                    .overlay(shape.strokeBorder(
                        LinearGradient(colors: [.white.opacity(selected ? 0.4 : 0.22), .white.opacity(0.05)], startPoint: .top, endPoint: .bottom),
                        lineWidth: 1))
            }
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(Theme.Builder.ease, value: selected)
    }
}

/// Where the add state shows: on the cover itself, or in a round control at the row's end.
private enum BuilderRowStyleKind { case coverCheck, trailingControl }

private struct BuilderRow: View {
    let draft: BuilderDraft
    let pick: BuilderPick
    let kind: BuilderRowStyleKind

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var release: Release? { draft.library.release(pick.releaseID) }
    private var track: Track? { pick.trackID.flatMap { id in release?.tracks.first { $0.id == id } } }
    private var title: String { track?.title ?? release?.title ?? "" }
    private var isAdopted: Bool { release?.source == .adopted }
    private var state: BuilderRowState { draft.state(of: pick) }
    private var isOn: Bool { state != .off }

    private var subtitle: String {
        guard let release else { return "" }
        if track != nil { return release.artist }
        return "\(release.artist) \u{00B7} \(Copy.CollectionBuilder.songCount(release.tracks.count))"
    }

    private var accessibilityText: String {
        [title, subtitle, isAdopted ? Copy.Collections.onYourMac : nil].compactMap { $0 }.joined(separator: ", ")
    }

    var body: some View {
        Button { draft.toggle(pick) } label: {
            HStack(spacing: 14) {
                thumb
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(Theme.ScaledFont.trackTitle)
                        .foregroundStyle(Theme.primaryText)
                        .multilineTextAlignment(.leading)
                    Text(state == .existing ? Copy.CollectionBuilder.inCollection : subtitle)
                        .font(Theme.ScaledFont.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                        .multilineTextAlignment(.leading)
                    if isAdopted { macMark }
                }
                Spacer(minLength: 0)
                if let length = track.flatMap({ TrackLength.format($0.durationSec) }), !dynamicTypeSize.isAccessibilitySize, kind == .coverCheck {
                    Text(length)
                        .font(Theme.ScaledFont.trackNumber)
                        .foregroundStyle(Theme.secondaryText)
                }
                if kind == .trailingControl {
                    BuilderCheck(tint: draft.tint, on: isOn, dimmed: state == .existing || state == .viaRelease)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: Theme.Builder.rowMinHeight, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(BuilderRowStyle(tint: draft.tint, selected: state == .on))
        .disabled(state == .existing || state == .viaRelease)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityValue(isOn ? Copy.CollectionBuilder.added : "")
        .accessibilityHint(isOn ? "" : Copy.CollectionBuilder.add(title))
        .accessibilityAddTraits(state == .on ? .isSelected : [])
    }

    private var thumb: some View {
        BuilderThumb(image: draft.library.images[pick.releaseID])
            .overlay {
                if kind == .coverCheck, isOn {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.black.opacity(0.35))
                        RoundedRectangle(cornerRadius: 10, style: .continuous).fill(draft.tint.opacity(state == .on ? 0.85 : 0.4))
                        GlowGlass().clipShape(.rect(cornerRadius: 10, style: .continuous))
                        Image(systemName: "checkmark")
                            .font(.system(.title3, weight: .bold))
                            .foregroundStyle(Color.white)
                    }
                    .transition(.opacity)
                }
            }
            .animation(Theme.Builder.ease, value: isOn)
    }

    private var macMark: some View {
        Label(Copy.Collections.onYourMac, systemImage: "desktopcomputer")
            .font(Theme.ScaledFont.pill)
            .foregroundStyle(Theme.primaryText)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background { Capsule().fill(Color.white.opacity(0.14)) }
            .overlay { Capsule().strokeBorder(Color.white.opacity(0.25), lineWidth: 1) }
    }
}

private struct BuilderSectionTitle: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.ScaledFont.sectionTitle)
            .foregroundStyle(Theme.secondaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
            .padding(.top, 8)
            .accessibilityAddTraits(.isHeader)
    }
}

/// "No matches" for a search that finds nothing.
private struct BuilderNoMatches: View {
    let query: String

    var body: some View {
        Text(Copy.Collections.noMatches(query))
            .font(Theme.ScaledFont.rowTitle)
            .foregroundStyle(Theme.secondaryText)
            .frame(maxWidth: .infinity)
            .padding(.top, 24)
    }
}

private struct BuilderDonePill: View {
    let draft: BuilderDraft
    let label: String
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(label, action: action)
            .buttonStyle(CoverGlowButtonStyle(colors: draft.glow))
            .disabled(!isEnabled)
    }
}

/// The red X: no circle.
private struct BuilderClose: View {
    var body: some View {
        Button {} label: {
            Image(systemName: "xmark")
                .font(.system(.body, weight: .bold))
                .foregroundStyle(Theme.danger)
                .frame(width: Theme.Builder.control, height: Theme.Builder.control)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(Copy.CollectionBuilder.close)
    }
}

// MARK: - Variant 1: one screen

struct BuilderOneScreen: View {
    let draft: BuilderDraft
    var onDone: () -> Void = {}

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var sleeveSize: CGFloat { dynamicTypeSize.isAccessibilitySize ? Theme.Builder.sleeveAccessibility : Theme.Builder.sleeve }
    private var title: String { draft.isNew ? Copy.CollectionBuilder.newTitle : Copy.CollectionBuilder.addMusicTitle }
    private var searching: Bool { !LibrarySearch.normalize(draft.query).isEmpty }

    var body: some View {
        @Bindable var draft = draft
        ZStack {
            BuilderBackdrop(draft: draft)
            ScrollView {
                LazyVStack(spacing: 10, pinnedViews: [.sectionHeaders]) {
                    HStack {
                        Text(title)
                            .font(Theme.ScaledFont.headline)
                            .foregroundStyle(Theme.primaryText)
                            .accessibilityAddTraits(.isHeader)
                        Spacer()
                        BuilderClose()
                    }
                    BuilderSleeve(draft: draft, size: sleeveSize)
                        .padding(.top, 4)
                        .padding(.bottom, 18)
                    Section {
                        library
                    } header: {
                        VStack(spacing: 8) {
                            BuilderPicksBar(draft: draft)
                            BuilderSearchBox(text: $draft.query)
                        }
                        .padding(.top, 8)
                        .padding(.bottom, 10)
                        .background {
                            LinearGradient(stops: [.init(color: .black.opacity(0.88), location: 0), .init(color: .black.opacity(0.88), location: 0.8), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom)
                                .padding(.horizontal, -Theme.Spacing.pagePadding)
                        }
                    }
                }
                .padding(.horizontal, Theme.Spacing.pagePadding)
            }
            .scrollDismissesKeyboard(.immediately)
        }
        .safeAreaInset(edge: .bottom) {
            BuilderDonePill(draft: draft, label: Copy.CollectionBuilder.done, isEnabled: !draft.isNew || MusicCollection.validName(draft.name) != nil, action: onDone)
                .padding(.horizontal, Theme.Spacing.pagePadding)
                .padding(.top, 16)
                .padding(.bottom, 6)
                .background {
                LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black.opacity(0.97), location: 0.3), .init(color: .black.opacity(0.97), location: 1)], startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
            }
        }
        .sensoryFeedback(.selection, trigger: draft.picks)
    }

    @ViewBuilder
    private var library: some View {
        let releases = draft.releaseMatches
        let songs = draft.songMatches
        if releases.isEmpty && songs.isEmpty {
            BuilderNoMatches(query: draft.query)
        }
        if !releases.isEmpty {
            BuilderSectionTitle(text: Copy.CollectionBuilder.releases)
            ForEach(releases) { release in
                BuilderRow(draft: draft, pick: BuilderPick(releaseID: release.id), kind: .coverCheck)
            }
        }
        if !songs.isEmpty {
            BuilderSectionTitle(text: Copy.CollectionBuilder.songs)
            ForEach(songs, id: \.track.id) { entry in
                BuilderRow(draft: draft, pick: BuilderPick(releaseID: entry.release.id, trackID: entry.track.id), kind: .coverCheck)
            }
        }
    }
}

// MARK: - Variant 1b: one screen, sleek

/// A cover's own accent colour, worked out once per release.
@MainActor
private enum BuilderAccent {
    private static var cache: [UUID: Color] = [:]

    static func color(_ id: UUID, in library: BuilderLibrary) -> Color {
        if let hit = cache[id] { return hit }
        let color = Theme.coverGlowColors(ArtworkPalette.palette(forCover: library.data[id])).first ?? Theme.accent
        cache[id] = color
        return color
    }
}

/// A cover square with its own corner radius, or the double note when there is no art.
private struct BuilderCover: View {
    let image: UIImage?
    let side: CGFloat
    let radius: CGFloat

    var body: some View {
        Color.clear
            .frame(width: side, height: side)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    NoCoverArt()
                }
            }
            .clipShape(.rect(cornerRadius: radius, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// `GlowRim`'s look on a rounded square, in the cover's colour (`GlowRim` only draws capsules and circles).
private struct BuilderCoverRim: View {
    let tint: Color
    let radius: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .strokeBorder(
                LinearGradient(colors: [tint.opacity(0.95), tint.opacity(0.55)], startPoint: .top, endPoint: .bottom),
                lineWidth: 1.5)
            .shadow(color: tint.opacity(0.55), radius: 8)
            .allowsHitTesting(false)
    }
}

/// A filled accent circle with a white check; a dim one for what the collection already holds.
private struct BuilderPickedDot: View {
    let tint: Color
    let size: CGFloat
    var dimmed = false
    var glows = false

    var body: some View {
        ZStack {
            Circle().fill(dimmed ? Color.white.opacity(0.22) : tint)
            // A little black keeps the white check readable on a bright cover.
            Circle().fill(Color.black.opacity(dimmed ? 0 : 0.22))
            Image(systemName: "checkmark")
                .font(.system(size: size * 0.46, weight: .bold))
                .foregroundStyle(Color.white.opacity(dimmed ? 0.7 : 1))
        }
        .frame(width: size, height: size)
        .shadow(color: glows && !dimmed ? tint.opacity(0.6) : .clear, radius: 7)
        .accessibilityHidden(true)
    }
}

private struct BuilderPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// The picks as overlapping mini sleeves, tilted the other way each time. No panel, no border.
private struct BuilderCrate: View {
    let draft: BuilderDraft

    private static let shown = 5
    private static let side: CGFloat = 52

    var body: some View {
        let picks = Array(draft.picks.prefix(Self.shown))
        let extra = draft.picks.count - picks.count
        HStack(spacing: -18) {
            if picks.isEmpty {
                ForEach(0..<3, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color(white: 0.13))
                        .frame(width: Self.side, height: Self.side)
                        .rotationEffect(.degrees(index.isMultiple(of: 2) ? -4 : 4))
                }
            }
            ForEach(Array(picks.enumerated()), id: \.element) { index, pick in
                BuilderCover(image: draft.library.images[pick.releaseID], side: Self.side, radius: 10)
                    .shadow(color: .black.opacity(0.45), radius: 6, x: 2, y: 3)
                    .rotationEffect(.degrees(index.isMultiple(of: 2) ? -4 : 4))
                    .zIndex(Double(index))
            }
            if extra > 0 {
                Text("+\(extra)")
                    .font(Theme.ScaledFont.pill)
                    .foregroundStyle(Theme.primaryText)
                    .frame(width: Self.side, height: Self.side)
                    .zIndex(Double(Self.shown))
            }
        }
        .padding(.vertical, 6)
        .accessibilityHidden(true)
    }
}

/// A release on the shelf: one cover, one tap adds or removes the whole release.
private struct BuilderShelfCover: View {
    let draft: BuilderDraft
    let release: Release
    let side: CGFloat

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private static let radius: CGFloat = 12

    private var pick: BuilderPick { BuilderPick(releaseID: release.id) }
    private var state: BuilderRowState { draft.state(of: pick) }
    private var isOn: Bool { state != .off }
    private var tint: Color { BuilderAccent.color(release.id, in: draft.library) }

    private var label: String {
        var parts = [release.title, release.artist]
        if release.source == .adopted { parts.append(Copy.Collections.onYourMac) }
        if state == .existing { parts.append(Copy.CollectionBuilder.inCollection.lowercased()) }
        else if isOn { parts.append(Copy.CollectionBuilder.added.lowercased()) }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        Button { draft.toggle(pick) } label: {
            VStack(alignment: .leading, spacing: 8) {
                BuilderCover(image: draft.library.images[release.id], side: side, radius: Self.radius)
                    .shadow(color: .black.opacity(0.4), radius: 10, y: 6)
                    .overlay { if state == .on { BuilderCoverRim(tint: tint, radius: Self.radius) } }
                    .overlay(alignment: .topTrailing) {
                        if isOn { BuilderPickedDot(tint: tint, size: 28, dimmed: state == .existing).padding(8) }
                    }
                Text(release.title)
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                    .multilineTextAlignment(.leading)
                Text(release.artist)
                    .font(.system(.footnote))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                    .multilineTextAlignment(.leading)
            }
            .frame(width: side, alignment: .topLeading)
            .contentShape(Rectangle())
        }
        .buttonStyle(BuilderPressStyle())
        .disabled(state == .existing)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityHint(isOn ? "" : Copy.CollectionBuilder.add(release.title))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// A song on the backdrop: no box, no separator; a picked one gets a faint wash of its cover.
private struct BuilderSongRow: View {
    let draft: BuilderDraft
    let release: Release
    let track: Track

    private var pick: BuilderPick { BuilderPick(releaseID: release.id, trackID: track.id) }
    private var state: BuilderRowState { draft.state(of: pick) }
    private var isOn: Bool { state != .off }
    private var tint: Color { BuilderAccent.color(release.id, in: draft.library) }
    private var isAdopted: Bool { release.source == .adopted }

    private var subtitle: String {
        state == .existing ? Copy.CollectionBuilder.inCollection : "\(release.artist) \u{00B7} \(release.title)"
    }

    private var label: String {
        var parts = [track.title, release.artist, release.title]
        if isAdopted { parts.append(Copy.Collections.onYourMac) }
        if state == .existing { parts.append(Copy.CollectionBuilder.inCollection.lowercased()) }
        else if isOn { parts.append(Copy.CollectionBuilder.added.lowercased()) }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        Button { draft.toggle(pick) } label: {
            HStack(spacing: 14) {
                BuilderCover(image: draft.library.images[release.id], side: 52, radius: 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.title)
                        .font(.system(.body, weight: .semibold))
                        .foregroundStyle(Theme.primaryText)
                        .multilineTextAlignment(.leading)
                    (Text(subtitle) + (isAdopted ? Text("  ") + Text(Image(systemName: "desktopcomputer")) : Text("")))
                        .font(Theme.ScaledFont.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                control
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(tint.opacity(state == .on ? 0.10 : 0))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(BuilderPressStyle())
        .disabled(state == .existing || state == .viaRelease)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityHint(isOn ? "" : Copy.CollectionBuilder.add(track.title))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    @ViewBuilder
    private var control: some View {
        if isOn {
            BuilderPickedDot(tint: tint, size: 30, dimmed: state != .on, glows: true)
        } else {
            ZStack {
                Circle().strokeBorder(Color.white.opacity(0.35), lineWidth: 1)
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.7))
            }
            .frame(width: 30, height: 30)
            .accessibilityHidden(true)
        }
    }
}

/// The frosted search pill: a hairline, no heavy rim.
private struct BuilderSearchPill: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.secondaryText)
                .accessibilityHidden(true)
            TextField("", text: $text, prompt: Text(Copy.CollectionBuilder.searchPlaceholder).foregroundColor(Theme.secondaryText))
                .font(Theme.ScaledFont.input)
                .foregroundStyle(Theme.primaryText)
                .submitLabel(.search)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.secondaryText)
                        .frame(width: Theme.Builder.control, height: Theme.Builder.control)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Copy.CollectionBuilder.clearSearch)
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, text.isEmpty ? 16 : 2)
        .frame(minHeight: 48)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                Color.black.opacity(0.45)
            }
            .clipShape(Capsule())
        }
        .overlay { Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5) }
    }
}

/// The round Done: cover-tinted glass with a check.
private struct BuilderDoneRound: View {
    let draft: BuilderDraft
    let isEnabled: Bool
    let action: () -> Void

    private var label: String {
        draft.songCount > 0 ? "\(Copy.CollectionBuilder.done), \(Copy.CollectionBuilder.songCount(draft.songCount))" : Copy.CollectionBuilder.done
    }

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().fill(Color.black.opacity(0.8))
                Circle().fill(draft.tint.opacity(0.4))
                GlowGlass().clipShape(Circle())
                Image(systemName: "checkmark")
                    .font(.system(.body, weight: .bold))
                    .foregroundStyle(Color.white)
            }
            .overlay { GlowRim(round: true) }
            .frame(width: 48, height: 48)
            .shadow(color: draft.tint.opacity(isEnabled ? 0.4 : 0), radius: 12, y: 3)
            .contentShape(Circle())
        }
        .buttonStyle(BuilderPressStyle())
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.4)
        .accessibilityLabel(label)
    }
}

struct BuilderOneScreenSleek: View {
    let draft: BuilderDraft
    var onDone: () -> Void = {}

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var large: Bool { dynamicTypeSize.isAccessibilitySize }
    private var sleeveSize: CGFloat { large ? Theme.Builder.sleeveAccessibility : Theme.Builder.sleeve }
    private var shelfSide: CGFloat { large ? 112 : 132 }
    private var title: String { draft.isNew ? Copy.CollectionBuilder.newTitle : Copy.CollectionBuilder.addMusicTitle }
    private var canFinish: Bool { draft.songCount > 0 && (!draft.isNew || MusicCollection.validName(draft.name) != nil) }
    private var pad: CGFloat { Theme.Spacing.pagePadding }

    var body: some View {
        ZStack {
            BuilderBackdrop(draft: draft)
            // One long fade to near-black, so no edge shows anywhere.
            LinearGradient(stops: [
                .init(color: .black.opacity(0), location: 0),
                .init(color: .black.opacity(0.06), location: 0.15),
                .init(color: .black.opacity(0.22), location: 0.3),
                .init(color: .black.opacity(0.55), location: 0.45),
                .init(color: .black.opacity(0.88), location: 0.58),
                .init(color: .black.opacity(0.94), location: 0.7),
                .init(color: .black.opacity(0.96), location: 1),
            ], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
            ScrollView {
                VStack(spacing: 0) {
                    HStack {
                        Text(title)
                            .font(Theme.ScaledFont.headline)
                            .foregroundStyle(Theme.primaryText)
                            .accessibilityAddTraits(.isHeader)
                        Spacer()
                        BuilderClose()
                    }
                    .padding(.horizontal, pad)
                    BuilderSleeve(draft: draft, size: sleeveSize)
                        .padding(.top, large ? 14 : 4)
                        .padding(.bottom, 16)
                    picksBar.padding(.horizontal, pad)
                    library
                }
                .padding(.bottom, 12)
            }
            .scrollDismissesKeyboard(.immediately)
        }
        .safeAreaInset(edge: .bottom) { bottomBar }
        .sensoryFeedback(.selection, trigger: draft.picks)
    }

    private var picksBar: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                BuilderCrate(draft: draft)
                Spacer(minLength: 0)
                summary.multilineTextAlignment(.trailing)
            }
            VStack(alignment: .leading, spacing: 4) {
                BuilderCrate(draft: draft)
                summary
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summary: some View {
        Text(draft.summary)
            .font(Theme.ScaledFont.subheadline)
            .foregroundStyle(Theme.secondaryText)
            .accessibilityLabel(draft.summary)
    }

    @ViewBuilder
    private var library: some View {
        let releases = draft.releaseMatches
        let songs = draft.songMatches
        VStack(spacing: 6) {
            if releases.isEmpty && songs.isEmpty {
                BuilderNoMatches(query: draft.query)
            }
            if !releases.isEmpty {
                BuilderSectionTitle(text: Copy.CollectionBuilder.releases)
                    .padding(.horizontal, pad)
                    .padding(.top, 14)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 14) {
                        ForEach(releases) { release in
                            BuilderShelfCover(draft: draft, release: release, side: shelfSide)
                        }
                    }
                    .padding(.horizontal, pad)
                    .padding(.top, 8)
                    .padding(.bottom, 14)
                }
                .scrollClipDisabled()
            }
            if !songs.isEmpty {
                BuilderSectionTitle(text: Copy.CollectionBuilder.songs)
                    .padding(.horizontal, pad)
                    .padding(.top, 6)
                VStack(spacing: 2) {
                    ForEach(songs, id: \.track.id) { entry in
                        BuilderSongRow(draft: draft, release: entry.release, track: entry.track)
                    }
                }
                .padding(.horizontal, max(0, pad - 10))
            }
        }
    }

    /// The search pill and Done float over the page; at large text they stack.
    private var bottomBar: some View {
        @Bindable var draft = draft
        return Group {
            if large {
                VStack(alignment: .trailing, spacing: 10) {
                    BuilderSearchPill(text: $draft.query)
                    Button(Copy.CollectionBuilder.done, action: onDone)
                        .buttonStyle(CoverGlowButtonStyle(colors: self.draft.glow, isFullWidth: false))
                        .disabled(!canFinish)
                        .accessibilityLabel(self.draft.songCount > 0 ? "\(Copy.CollectionBuilder.done), \(Copy.CollectionBuilder.songCount(self.draft.songCount))" : Copy.CollectionBuilder.done)
                }
            } else {
                HStack(spacing: 10) {
                    BuilderSearchPill(text: $draft.query)
                    BuilderDoneRound(draft: self.draft, isEnabled: canFinish, action: onDone)
                }
            }
        }
        .padding(.horizontal, pad)
        .padding(.top, 44)
        .padding(.bottom, 6)
        .background {
            LinearGradient(stops: [.init(color: .black.opacity(0), location: 0), .init(color: .black.opacity(0.92), location: 0.4), .init(color: .black.opacity(0.95), location: 1)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
        }
    }
}

// MARK: - Variant 2: name, then pick

/// Step 1: the empty sleeve centre stage, the name typed large on it.
struct BuilderNameStep: View {
    let draft: BuilderDraft
    var autofocus = false
    var onNext: () -> Void = {}

    var body: some View {
        ZStack {
            BuilderBackdrop(draft: draft)
            VStack(spacing: 20) {
                HStack {
                    Text(Copy.CollectionBuilder.newTitle)
                        .font(Theme.ScaledFont.headline)
                        .foregroundStyle(Theme.primaryText)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    BuilderClose()
                }
                Spacer(minLength: 0)
                BuilderSleeve(draft: draft, size: Theme.Builder.sleeveLarge, autofocus: autofocus)
                Text(Copy.CollectionBuilder.nameHint)
                    .font(Theme.ScaledFont.rowTitle)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Theme.Spacing.pagePadding)
        }
        .safeAreaInset(edge: .bottom) {
            BuilderDonePill(draft: draft, label: Copy.CollectionBuilder.next, isEnabled: MusicCollection.validName(draft.name) != nil, action: onNext)
                .padding(.horizontal, Theme.Spacing.pagePadding)
                .padding(.vertical, 6)
        }
    }
}

/// Step 2 (and "Add music"): the picker as a sheet, with the picks pinned above Done.
struct BuilderPickerSheet: View {
    @Bindable var draft: BuilderDraft
    var onDone: () -> Void = {}

    var body: some View {
        ZStack {
            BuilderBackdrop(draft: draft)
            VStack(spacing: 12) {
                Text(Copy.CollectionBuilder.addTo(draft.name))
                    .font(Theme.ScaledFont.headline)
                    .foregroundStyle(Theme.primaryText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 26)
                    .accessibilityAddTraits(.isHeader)
                BuilderSearchBox(text: $draft.query)
                GlowSwitch(
                    options: [(BuilderTab.songs, "music.note", Copy.CollectionBuilder.songs), (BuilderTab.releases, "square.stack", Copy.CollectionBuilder.releases)],
                    selection: $draft.tab, tint: draft.tint)
                ScrollView {
                    LazyVStack(spacing: 10) { rows }
                        .padding(.bottom, 8)
                }
                .scrollDismissesKeyboard(.immediately)
            }
            .padding(.horizontal, Theme.Spacing.pagePadding)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                BuilderPicksBar(draft: draft)
                BuilderDonePill(draft: draft, label: Copy.CollectionBuilder.done, action: onDone)
            }
            .padding(.horizontal, Theme.Spacing.pagePadding)
            .padding(.top, 10)
            .padding(.bottom, 6)
            .background {
                LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black.opacity(0.97), location: 0.16), .init(color: .black.opacity(0.97), location: 1)], startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
            }
        }
        .sensoryFeedback(.selection, trigger: draft.picks)
    }

    @ViewBuilder
    private var rows: some View {
        switch draft.tab {
        case .songs:
            let songs = draft.songMatches
            if songs.isEmpty { BuilderNoMatches(query: draft.query) }
            ForEach(songs, id: \.track.id) { entry in
                BuilderRow(draft: draft, pick: BuilderPick(releaseID: entry.release.id, trackID: entry.track.id), kind: .trailingControl)
            }
        case .releases:
            let releases = draft.releaseMatches
            if releases.isEmpty { BuilderNoMatches(query: draft.query) }
            ForEach(releases) { release in
                BuilderRow(draft: draft, pick: BuilderPick(releaseID: release.id), kind: .trailingControl)
            }
        }
    }
}

/// Step 1 with the picker open over it (a flow the gallery can start at either step).
private struct BuilderTwoStepFlow: View {
    @State var draft: BuilderDraft
    @State var showsPicker: Bool
    var size: DynamicTypeSize = .large

    var body: some View {
        BuilderNameStep(draft: draft) { showsPicker = true }
            .dynamicTypeSize(size)
            .sheet(isPresented: $showsPicker) {
                BuilderPickerSheet(draft: draft) { showsPicker = false }
                    .dynamicTypeSize(size)
                    .presentationDragIndicator(.visible)
                    .presentationBackground(Theme.background)
            }
    }
}

// MARK: - Gallery

/// `-componentGallery builder-...`: the two variants over the sample library.
struct CollectionBuilderGallery: View {
    static let names = [
        "builder-1-empty", "builder-1-picks", "builder-1-search", "builder-1-ax3", "builder-1-add-music",
        "builder-1b-empty", "builder-1b-picks", "builder-1b-search", "builder-1b-ax3", "builder-1b-add-music",
        "builder-2-name", "builder-2-empty", "builder-2-picks", "builder-2-search", "builder-2-ax3", "builder-2-add-music",
    ]

    let name: String

    private static let library = BuilderLibrary.sample

    private static func pick(_ release: Int, track: Int? = 0) -> BuilderPick {
        let item = library.releases[release]
        return BuilderPick(releaseID: item.id, trackID: track.map { item.tracks[$0].id })
    }

    /// Low Tide, Midnight Drive and the adopted Low Light.
    private static var threePicks: [BuilderPick] { [pick(1), pick(4), pick(8)] }

    /// What "Late drives" holds in the Collections gallery.
    private static var lateDrives: [BuilderPick] {
        [pick(0, track: nil), pick(1), pick(8, track: nil), pick(2, track: nil)]
    }

    private func draft(picks: [BuilderPick] = [], query: String = "", name: String = "Rainy Sunday") -> BuilderDraft {
        let draft = BuilderDraft(library: Self.library, name: name, picks: picks)
        draft.query = query
        return draft
    }

    private func addMusicDraft() -> BuilderDraft {
        let draft = BuilderDraft(library: Self.library, name: "Late drives", existing: Self.lateDrives, picks: [Self.pick(4), Self.pick(5)])
        return draft
    }

    var body: some View {
        Group {
            switch name {
            case "builder-1-empty":
                BuilderOneScreen(draft: draft(name: ""))
            case "builder-1-picks":
                BuilderOneScreen(draft: draft(picks: Self.threePicks))
            case "builder-1-search":
                BuilderOneScreen(draft: draft(picks: Self.threePicks, query: "night"))
            case "builder-1-ax3":
                BuilderOneScreen(draft: draft(picks: Self.threePicks)).dynamicTypeSize(.accessibility3)
            case "builder-1-add-music":
                BuilderOneScreen(draft: addMusicDraft())
            case "builder-1b-empty":
                BuilderOneScreenSleek(draft: draft(name: ""))
            case "builder-1b-picks":
                BuilderOneScreenSleek(draft: draft(picks: Self.threePicks + [Self.pick(0, track: nil)]))
            case "builder-1b-search":
                BuilderOneScreenSleek(draft: draft(picks: Self.threePicks, query: "night"))
            case "builder-1b-ax3":
                BuilderOneScreenSleek(draft: draft(picks: Self.threePicks)).dynamicTypeSize(.accessibility3)
            case "builder-1b-add-music":
                BuilderOneScreenSleek(draft: addMusicDraft())
            case "builder-2-name":
                BuilderNameStep(draft: draft(name: "Rainy Sunday"))
            case "builder-2-empty":
                BuilderTwoStepFlow(draft: draft(), showsPicker: true)
            case "builder-2-picks":
                BuilderTwoStepFlow(draft: draft(picks: Self.threePicks), showsPicker: true)
            case "builder-2-search":
                BuilderTwoStepFlow(draft: draft(picks: Self.threePicks, query: "night"), showsPicker: true)
            case "builder-2-ax3":
                BuilderTwoStepFlow(draft: draft(picks: Self.threePicks), showsPicker: true, size: .accessibility3)
            case "builder-2-add-music":
                AddMusicOverCollection(draft: addMusicDraft())
            default:
                EmptyView()
            }
        }
        .preferredColorScheme(.dark)
    }
}

/// The picker opened from an existing collection's page (the real page, behind).
private struct AddMusicOverCollection: View {
    let draft: BuilderDraft
    @State private var showsPicker = true

    var body: some View {
        CollectionsGallery.queue()
            .sheet(isPresented: $showsPicker) {
                BuilderPickerSheet(draft: draft) { showsPicker = false }
                    .presentationDragIndicator(.visible)
                    .presentationBackground(Theme.background)
            }
    }
}
#endif
