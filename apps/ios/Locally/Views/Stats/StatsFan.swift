import SwiftUI
import UIKit

/// Where the sleeves of the Stats fan sit (port of `apps/web/src/lib/fan-layout.ts`). Pure.
enum FanLayout {
    struct Slot: Equatable {
        /// Steps from the middle, left negative. Whole numbers for an odd count, halves for an even one.
        var offset: Double
        /// Tilt in degrees; negative leans left.
        var angle: Double
        /// Stacking, higher on top: number one over the rest, then the inner ones over the outer.
        var layer: Int
    }

    static let maxCount = 5
    /// Degrees of tilt per step from the middle, by how many sleeves there are.
    private static let degreesPerStep: [Double] = [0, 0, 14, 12, 11.5, 11]

    /// One slot per item, in rank order: number one in the middle, silver on its left and bronze on
    /// its right, then four on the left and five on the right. With fewer than five the same rule
    /// runs on what there is and the set is centred. An even count leaves the gold half a step right.
    static func slots(count: Int) -> [Slot] {
        let n = max(0, min(maxCount, count))
        if n == 0 { return [] }
        var lefts: [Int] = []
        var rights: [Int] = []
        for i in 1..<n {
            if i % 2 == 1 { lefts.append(i) } else { rights.append(i) }
        }
        let leftToRight = lefts.reversed() + [0] + rights
        let degrees = degreesPerStep[n]
        var slots = [Slot](repeating: Slot(offset: 0, angle: 0, layer: 0), count: n)
        for (position, rank) in leftToRight.enumerated() {
            let offset = Double(position) - Double(n - 1) / 2
            slots[rank] = Slot(offset: offset, angle: offset * degrees, layer: 50 - Int((abs(offset) * 2).rounded()) * 10 - rank)
        }
        return slots
    }
}

/// The fan's measurements, all multiples of the sleeve width `w` as on the Mac (`.fan[data-size="page"]`
/// at a narrow width): sleeves turn about one far pivot, so they sit on one shallow arc.
struct FanGeometry {
    /// How far below the sleeve's top the pivot is, in sleeve widths.
    static let pivot: CGFloat = 4.1
    static let tilt: Double = 1.15
    static let activeTilt: Double = 0.8
    static let depth: CGFloat = 0.06
    static let shadeBase: Double = 0.06
    static let shade: Double = 0.1
    static let restLift: CGFloat = 0.3
    static let fullLift: CGFloat = 0.6
    static let openingLift: CGFloat = 0.05
    static let pop: CGFloat = 1.12
    static let openingPop: CGFloat = 1.04
    static let fanInDrop: CGFloat = 0.3

    let slots: [FanLayout.Slot]
    let width: CGFloat
    let w: CGFloat

    /// The sleeve is the smaller of its cap, about a third of the room, and what lets the whole
    /// tilted fan, outer sleeves included, sit inside the room.
    init(count: Int, width: CGFloat) {
        slots = FanLayout.slots(count: count)
        self.width = width
        let radius = Self.pivot - 0.5
        var half: CGFloat = 0.5
        for slot in slots {
            let a = CGFloat(slot.angle * Self.tilt * .pi / 180)
            let scale = 1 - CGFloat(abs(slot.offset)) * Self.depth
            let reach = abs(radius * sin(a)) + 0.5 * scale * (abs(cos(a)) + abs(sin(a)))
            half = max(half, reach)
        }
        w = max(40, min(Theme.Stats.maxSleeve, width * Theme.Stats.sleeveWidthFraction, (width - 4) / (2 * half)))
    }

    /// Room above the resting sleeves for the lift, the pop and the record's peek.
    var topRoom: CGFloat { w * 0.9 + 12 }
    /// The stage: the lift room, the sleeve, and the drop of the outer sleeves' lower corners.
    var height: CGFloat { topRoom + w + w * 0.6 }
    var pivotPoint: CGPoint { CGPoint(x: width / 2, y: topRoom + Self.pivot * w) }
    /// The distance from the pivot to a sleeve's centre at rest.
    var restRadius: CGFloat { (Self.pivot - 0.5) * w }
}

/// Places a square on the wheel: turned `angle` degrees about the pivot and `radius` out from it.
/// Animatable, so the fan-in and the lift move along the arc rather than in a straight line.
private struct WheelPlacement: ViewModifier, Animatable {
    var angle: Double
    var radius: CGFloat
    let pivot: CGPoint
    let size: CGFloat

    var animatableData: AnimatablePair<Double, CGFloat> {
        get { AnimatablePair(angle, radius) }
        set { angle = newValue.first; radius = newValue.second }
    }

    func body(content: Content) -> some View {
        let r = angle * .pi / 180
        content
            .frame(width: size, height: size)
            .rotationEffect(.degrees(angle))
            .offset(x: pivot.x + radius * CGFloat(sin(r)) - size / 2, y: pivot.y - radius * CGFloat(cos(r)) - size / 2)
    }
}

/// The top five as record sleeves in a fan (port of the Mac's `SleeveFan`, size "page"): number one
/// in the middle, silver and bronze either side, a medal rim and a record peeking out of the top.
/// First tap lifts a sleeve, a second tap on the lifted one plays the opening beat and opens it, a
/// tap elsewhere puts the lift back on number one (`armed` is that lifted sleeve). Under Reduce
/// Motion there is no fan-in, no shine and no beat, and the lift is instant.
struct StatsFan: View {
    let items: [StatItem]
    let disc: Bool
    let width: CGFloat
    let label: String
    let cache: StatsCoverCache
    let ownerOf: (StatItem) -> UUID?
    /// Whether the app may animate now (foreground, this tab, not Low Power).
    let isMotionActive: Bool
    /// Whether the screen is in use (app in the foreground, this tab selected). Leaving it cancels an opening beat.
    let isScreenActive: Bool
    /// The tab and period asked for, which change the moment they are chosen (the fan itself is
    /// keyed by what was last shown, so it stays mounted while a slow read lands). A change cancels a beat.
    let requestKey: String
    @Binding var armed: Int?
    let onOpen: (StatItem) -> Void

    @State private var fanned = false
    @State private var opening: Int?
    /// The opening beat's wait; cancelled whenever the fan goes away, so nothing opens after the reader left.
    @State private var openTask: Task<Void, Never>?
    @State private var epoch = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var geometry: FanGeometry { FanGeometry(count: items.count, width: width) }

    private var active: Int { min(armed ?? 0, max(items.count - 1, 0)) }

    private var liftCurve: Animation? {
        reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: Theme.Stats.liftDuration)
    }

    var body: some View {
        let g = geometry
        VStack(spacing: 6) {
            ZStack(alignment: .topLeading) {
                ground(g)
                ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                    sleeve(i, item, g)
                }
            }
            .frame(width: width, height: g.height, alignment: .topLeading)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(label)

            if items.indices.contains(active) {
                caption(items[active])
            }
        }
        .frame(width: width)
        .onDisappear(perform: cancelOpening)
        .onChange(of: requestKey) { _, _ in cancelOpening() }
        .onChange(of: isScreenActive) { _, active in
            if !active { cancelOpening() }
        }
        .task {
            if reduceMotion {
                fanned = true
            } else {
                try? await Task.sleep(nanoseconds: 40_000_000)
                fanned = true
            }
        }
    }

    // MARK: Pieces

    private func ground(_ g: FanGeometry) -> some View {
        ZStack(alignment: .topLeading) {
            // The shadow pool under the sleeves, and the plank line they stand on.
            Ellipse()
                .fill(RadialGradient(colors: [.black.opacity(0.55), .clear], center: .center, startRadius: 0, endRadius: width * 0.4))
                .frame(width: width * 0.8, height: g.w * 0.25)
                .offset(x: width * 0.1, y: g.topRoom + g.w * 0.62)
            Rectangle()
                .fill(LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .white.opacity(0.2), location: 0.2),
                        .init(color: .white.opacity(0.2), location: 0.8),
                        .init(color: .clear, location: 1),
                    ],
                    startPoint: .leading, endPoint: .trailing
                ))
                .frame(width: width, height: 1)
                .offset(y: g.topRoom + g.w * 0.65)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func sleeve(_ i: Int, _ item: StatItem, _ g: FanGeometry) -> some View {
        let slot = g.slots[i]
        let k = abs(slot.offset)
        let isActive = i == active
        let isOpening = opening == i
        let touched = armed != nil
        let lift = isActive ? (touched || isOpening ? FanGeometry.fullLift : FanGeometry.restLift) + (isOpening ? FanGeometry.openingLift : 0) : 0
        let tilt = slot.angle * FanGeometry.tilt * (isActive ? FanGeometry.activeTilt : 1)
        let scale = isActive ? FanGeometry.pop * (isOpening ? FanGeometry.openingPop : 1) : 1 - CGFloat(k) * FanGeometry.depth
        let shade = isActive ? 0 : FanGeometry.shadeBase + k * FanGeometry.shade
        let fanIn = Animation.timingCurve(0.16, 1, 0.3, 1, duration: Theme.Stats.fanInDuration)
            .delay(Theme.Stats.fanInBase + k * Theme.Stats.fanInStagger)
        let lifted = LiftState(active: active, touched: touched, opening: opening)

        return StatsFanSleeve(
            item: item, slot: slot, size: g.w, disc: disc, isActive: isActive, isOpening: isOpening,
            shade: shade, owner: ownerOf(item), cache: cache,
            shineActive: isMotionActive && !reduceMotion, epoch: epoch,
            onTap: { tap(i) }, onDirectOpen: { open(i) }
        )
        .scaleEffect(scale, anchor: .bottom)
        .modifier(WheelPlacement(
            angle: fanned ? tilt : 0,
            radius: fanned ? g.restRadius + lift * g.w : g.restRadius - FanGeometry.fanInDrop * g.w,
            pivot: g.pivotPoint, size: g.w
        ))
        .opacity(fanned ? 1 : 0)
        .animation(reduceMotion ? nil : fanIn, value: fanned)
        .animation(liftCurve, value: lifted)
        .zIndex(isActive ? 100 : Double(slot.layer))
    }

    private struct LiftState: Equatable {
        var active: Int
        var touched: Bool
        var opening: Int?
    }

    private func caption(_ item: StatItem) -> some View {
        VStack(spacing: 2) {
            Text(item.title)
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(StatsStyle.nameColor(item.medal))
                .lineLimit(2)
                .multilineTextAlignment(.center)
            Text(Copy.Stats.playsCount(item.plays))
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(Color.white.opacity(0.78))
        }
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }

    // MARK: Touch

    private func tap(_ i: Int) {
        guard opening == nil else { return }
        if armed == i {
            open(i)
        } else {
            armed = i
        }
    }

    /// Drops a beat that is waiting to open a release, and puts the lift back.
    private func cancelOpening() {
        openTask?.cancel()
        openTask = nil
        opening = nil
        armed = nil
    }

    /// Opening beat (the sleeve rises a little more and its record slides further out), then the release opens.
    private func open(_ i: Int) {
        guard opening == nil, items.indices.contains(i) else { return }
        let item = items[i]
        if reduceMotion {
            armed = nil
            onOpen(item)
            return
        }
        armed = i
        opening = i
        openTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(Theme.Stats.openingBeat * 1_000_000_000))
            guard !Task.isCancelled else { return }
            openTask = nil
            opening = nil
            armed = nil
            onOpen(item)
        }
    }
}

/// Medal colours for names and numbers.
enum StatsStyle {
    static func nameColor(_ medal: Medal?) -> Color {
        switch medal {
        case .gold: return Theme.Stats.gold
        case .silver: return Theme.Stats.silver
        case .bronze: return Theme.Stats.bronzeName
        case nil: return Theme.primaryText
        }
    }

    static func rankColor(_ medal: Medal?) -> Color {
        switch medal {
        case .gold: return Theme.Stats.gold
        case .silver: return Theme.Stats.silver
        case .bronze: return Theme.Stats.bronze
        case nil: return Theme.secondaryText
        }
    }
}

// MARK: - One sleeve

private struct StatsFanSleeve: View {
    let item: StatItem
    let slot: FanLayout.Slot
    let size: CGFloat
    let disc: Bool
    let isActive: Bool
    let isOpening: Bool
    let shade: Double
    let owner: UUID?
    let cache: StatsCoverCache
    let shineActive: Bool
    let epoch: Date
    let onTap: () -> Void
    let onDirectOpen: () -> Void

    @State private var image: UIImage?

    private var corner: CGFloat { min(max(size * 0.057, 8), 12) }
    private var ring: CGFloat { min(max(size * 0.0143, 2), 3) }

    private var shape: AnyShape {
        disc ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
    }

    /// How far the record rises above the sleeve's top, as a share of the record's height.
    private var peek: CGFloat {
        if isOpening { return 0.55 }
        if isActive { return 0.18 }
        return item.medal == .silver || item.medal == .bronze ? 0.13 : 0.09
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if !disc {
                StatsRecord(medal: item.medal, size: size * 0.88, label: image, shineActive: shineActive, epoch: epoch)
                    .offset(x: size * 0.06, y: -peek * size * 0.88)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            art
            badge
        }
        .frame(width: size, height: size, alignment: .topLeading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Copy.Stats.itemLabel(rank: item.rank, title: item.title, plays: item.plays))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onDirectOpen() }
        .task(id: owner) {
            guard let owner else { image = nil; return }
            image = cache.cached(owner)
            if image == nil { image = await cache.image(for: owner) }
        }
    }

    private var art: some View {
        ZStack {
            Theme.elevated
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: "music.note")
                    .font(.system(size: size * 0.22))
                    .foregroundStyle(Theme.secondaryText)
            }
            Color.black.opacity(shade)
        }
        .frame(width: size, height: size)
        .clipShape(shape)
        .overlay(shape.stroke(Color.white.opacity(0.14), lineWidth: 2).clipShape(shape))
        .background { medalRing }
        .shadow(color: (rimColor ?? .clear).opacity(0.45), radius: size * 0.09)
        .shadow(color: .black.opacity(0.55), radius: size * 0.09, y: size * 0.1)
        .contentShape(shape)
        .onTapGesture(perform: onTap)
    }

    /// The medal's ring: the same shape a little bigger, behind the cover.
    @ViewBuilder
    private var medalRing: some View {
        if let rim = rimColor {
            shape.fill(rim).scaleEffect((size + ring * 2) / size)
        }
    }

    private var rimColor: Color? {
        switch item.medal {
        case .gold: return Theme.Stats.goldRim
        case .silver: return Theme.Stats.silverRim
        case .bronze: return Theme.Stats.bronzeRim
        case nil: return nil
        }
    }

    private var badge: some View {
        let side = min(max(size * 0.133, 20), 28)
        let inset = disc ? size * 0.13 : min(max(size * 0.043, 6), 9)
        let isLeft = slot.offset < 0
        let color: Color
        switch item.medal {
        case .gold: color = Theme.Stats.gold
        case .silver: color = Color(red: 0xD3 / 255, green: 0xD8 / 255, blue: 0xE0 / 255)
        case .bronze: color = Theme.Stats.bronze
        case nil: color = Color.white.opacity(0.92)
        }
        return Text("\(item.rank)")
            .font(.system(size: min(max(size * 0.067, 11), 14), weight: .bold))
            .foregroundStyle(color)
            .frame(width: side, height: side)
            .background(Circle().fill(Color.black.opacity(0.78)))
            .padding(.top, inset)
            .padding(isLeft ? .leading : .trailing, inset)
            .frame(width: size, height: size, alignment: isLeft ? .topLeading : .topTrailing)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

// MARK: - The record

/// A vinyl record, peeking from behind a sleeve: gold, silver and bronze are metallic (a conic
/// sheen under fine grooves) and ranks four and five are black. The medals carry a soft band of
/// light that sweeps across the record, and only the record.
private struct StatsRecord: View {
    let medal: Medal?
    let size: CGFloat
    let label: UIImage?
    let shineActive: Bool
    let epoch: Date

    private static func stops(_ hexes: [String]) -> [Gradient.Stop] {
        let at: [Double] = [0, 0.12, 0.25, 0.40, 0.50, 0.62, 0.75, 0.90, 1]
        return zip(hexes, at).map { Gradient.Stop(color: ArtworkBackdrop.color(hex: $0), location: $1) }
    }

    private var sheen: [Gradient.Stop]? {
        switch medal {
        case .gold: return Self.stops(["#fff2bf", "#c8921e", "#ffe089", "#7d5609", "#fff2bf", "#c8921e", "#ffe089", "#7d5609", "#fff2bf"])
        case .silver: return Self.stops(["#ffffff", "#aeb6c2", "#eef2f7", "#5d6674", "#ffffff", "#aeb6c2", "#eef2f7", "#5d6674", "#ffffff"])
        case .bronze: return Self.stops(["#ffe3c8", "#b56a2c", "#f2b67e", "#6a3412", "#ffe3c8", "#b56a2c", "#f2b67e", "#6a3412", "#ffe3c8"])
        case nil: return nil
        }
    }

    private var rim: Color {
        switch medal {
        case .gold: return Color(red: 1, green: 240 / 255, blue: 190 / 255).opacity(0.5)
        case .silver: return Color.white.opacity(0.5)
        case .bronze: return Color(red: 1, green: 227 / 255, blue: 200 / 255).opacity(0.45)
        case nil: return Color.white.opacity(0.1)
        }
    }

    private var shineTint: Color {
        switch medal {
        case .silver: return .white
        case .bronze: return Color(red: 1, green: 228 / 255, blue: 200 / 255)
        default: return Color(red: 1, green: 246 / 255, blue: 214 / 255)
        }
    }

    private var shineDelay: Double {
        switch medal {
        case .gold: return Theme.Stats.shineDelays[0]
        case .silver: return Theme.Stats.shineDelays[1]
        default: return Theme.Stats.shineDelays[2]
        }
    }

    var body: some View {
        ZStack {
            if let sheen {
                // CSS conic angles start at the top; SwiftUI's start at the right.
                Circle().fill(AngularGradient(stops: sheen, center: .center, angle: .degrees(20 - 90)))
            } else {
                Circle().fill(Theme.Immersive.discColor)
            }
            grooves
            Circle()
                .inset(by: size * 0.18)
                .stroke(Color.black.opacity(medal == nil ? 0.35 : 0.28), lineWidth: 1)
            if medal != nil {
                RecordShine(tint: shineTint, delay: shineDelay, size: size, active: shineActive, epoch: epoch)
                    .clipShape(Circle())
            }
            Circle()
                .fill(labelFill)
                .overlay { if let label { Image(uiImage: label).resizable().scaledToFill().clipShape(Circle()) } }
                .overlay(Circle().stroke(Color.black.opacity(0.5), lineWidth: 2))
                .padding(size * 0.33)
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(rim, lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: size * 0.05, y: size * 0.04)
    }

    private var labelFill: Color { label == nil ? Theme.accent : .clear }

    private var grooves: some View {
        Canvas { context, canvas in
            let outer = canvas.width / 2
            var r = outer - 1.5
            while r > outer * 0.34 {
                let rect = CGRect(x: outer - r, y: outer - r, width: r * 2, height: r * 2)
                context.stroke(Path(ellipseIn: rect), with: .color(medal == nil ? Color.white.opacity(0.05) : Color.black.opacity(0.1)), lineWidth: 1)
                r -= 3
            }
        }
        .allowsHitTesting(false)
    }
}

/// The medals' shine, two soft feathered bands (the Mac's `fan-shine-sweep-a` and `-b`) on an 8 s
/// cycle: band A glides left to right through the top half (1.7 s), then band B glides right to
/// left through the body (1.8 s), starting at 45 % of the cycle. Each is eased, fades in and out as
/// it goes, and is clipped to the record. Plain alpha, no blend mode; offset and opacity only.
private struct RecordShine: View {
    let tint: Color
    let delay: Double
    let size: CGFloat
    let active: Bool
    let epoch: Date

    private static let ease = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.37, y: 0), endControlPoint: UnitPoint(x: 0.63, y: 1))

    /// One band's place in the cycle: when it starts, how long it takes, the rest of the Mac's keyframes.
    private struct Sweep {
        var start: Double
        var length: Double
        /// Share of the sweep spent fading in, and the share at which it starts fading out.
        var fadeIn: Double
        var fadeOutAt: Double
        var leftToRight: Bool
    }

    private static let sweepA = Sweep(start: 0, length: Theme.Stats.shineSweep, fadeIn: 0.2, fadeOutAt: 0.85, leftToRight: true)
    private static let sweepB = Sweep(start: 0.45 * Theme.Stats.shineCycle, length: 1.8, fadeIn: 4 / 22.5, fadeOutAt: 19 / 22.5, leftToRight: false)

    var body: some View {
        TimelineView(.animation(paused: !active)) { context in
            let t = context.date.timeIntervalSince(epoch) - delay
            let phase = t >= 0 ? t.truncatingRemainder(dividingBy: Theme.Stats.shineCycle) : -1
            ZStack {
                if active, phase >= 0 {
                    bandView(.sweepA, phase: phase)
                    bandView(.sweepB, phase: phase)
                }
            }
        }
        .frame(width: size, height: size)
        .allowsHitTesting(false)
    }

    private enum Which { case sweepA, sweepB }

    @ViewBuilder
    private func bandView(_ which: Which, phase: Double) -> some View {
        let sweep = which == .sweepA ? Self.sweepA : Self.sweepB
        let local = phase - sweep.start
        if local >= 0, local <= sweep.length {
            let p = local / sweep.length
            let envelope = p < sweep.fadeIn ? p / sweep.fadeIn : (p < sweep.fadeOutAt ? 1 : (1 - p) / (1 - sweep.fadeOutAt))
            let eased = CGFloat(Self.ease.value(at: p))
            let x = sweep.leftToRight ? -1 + 2 * eased : 1 - 2 * eased
            if which == .sweepA {
                band(angleStart: UnitPoint(x: -0.092, y: 0.341), end: UnitPoint(x: 1.092, y: 0.659), peak: 0.85, height: size * 0.5)
                    .offset(x: x * size, y: -size * 0.25)
                    .opacity(envelope)
            } else {
                // 75deg, from 12 % to 88 % of the record's height.
                band(angleStart: UnitPoint(x: -0.062, y: 0.698), end: UnitPoint(x: 1.062, y: 0.302), peak: 0.78, height: size * 0.76)
                    .offset(x: x * size, y: size * 0.12 + size * 0.38 - size * 0.5)
                    .opacity(envelope)
            }
        }
    }

    /// The Mac's band: clear to 28 %, up to `peak` light at the middle, clear again from 72 %.
    private func band(angleStart: UnitPoint, end: UnitPoint, peak: Double, height: CGFloat) -> some View {
        let shoulder = peak * 0.73
        let foot = peak * 0.21
        return Rectangle()
            .fill(LinearGradient(
                stops: [
                    .init(color: tint.opacity(0), location: 0.28),
                    .init(color: tint.opacity(foot), location: 0.38),
                    .init(color: tint.opacity(shoulder), location: 0.47),
                    .init(color: tint.opacity(peak), location: 0.50),
                    .init(color: tint.opacity(shoulder), location: 0.53),
                    .init(color: tint.opacity(foot), location: 0.62),
                    .init(color: tint.opacity(0), location: 0.72),
                ],
                startPoint: angleStart,
                endPoint: end
            ))
            .frame(width: size, height: height)
    }
}

// MARK: - Loading

/// Five faint sleeves on the same wheel and the same height as the real fan.
struct StatsFanSkeleton: View {
    let width: CGFloat

    var body: some View {
        let g = FanGeometry(count: FanLayout.maxCount, width: width)
        VStack(spacing: 6) {
            ZStack(alignment: .topLeading) {
                ForEach(0..<g.slots.count, id: \.self) { i in
                    let slot = g.slots[i]
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.06))
                        .scaleEffect(1 - CGFloat(abs(slot.offset)) * FanGeometry.depth, anchor: .bottom)
                        .modifier(WheelPlacement(angle: slot.angle * FanGeometry.tilt, radius: g.restRadius, pivot: g.pivotPoint, size: g.w))
                        .zIndex(Double(slot.layer))
                }
            }
            .frame(width: width, height: g.height, alignment: .topLeading)
            // Where the caption goes.
            VStack(spacing: 6) {
                Capsule().fill(Color.white.opacity(0.06)).frame(width: 140, height: 14)
                Capsule().fill(Color.white.opacity(0.06)).frame(width: 80, height: 12)
            }
            .frame(height: 38)
        }
        .frame(width: width)
        .accessibilityHidden(true)
    }
}
