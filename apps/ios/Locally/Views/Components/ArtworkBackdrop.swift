import Combine
import SwiftUI
import UIKit

/// The release page's colour wash, ported from the web's `.ambient-backdrop`: a soft primary
/// glow top-left, a secondary glow top-right and a deep colour fading to the page black.
/// It takes plain colours (the caller derives them from the cover), so it knows nothing
/// about artwork. A new set of colours cross-fades over `Theme.Immersive.backdropCrossFade`;
/// the glows drift slowly by transform only (no blur or material sits over the animation).
/// With Reduce Motion on there is no drift and colours change instantly. The drift also pauses
/// (`BackdropMotion`) while the app is in the background, the backdrop's tab is not the selected
/// one, or Low Power Mode is on.
/// `progress` (screens scrolled) turns the two glows against each other on top of the
/// drift, by `Immersive.scrollTurnPrimary` / `scrollTurnSecondary` degrees per screen as
/// the web's `.ambient-sky-1/-2` do, so a caller can link the wash to scrolling (the
/// library home does); it is ignored under Reduce Motion.
struct ArtworkBackdrop: View {
    private struct Palette: Equatable {
        var primary: Color
        var secondary: Color
        var deep: Color
    }

    private struct Layer: Identifiable {
        let id = UUID()
        let palette: Palette
    }

    private let palette: Palette
    private let progress: Double
    @State private var layers: [Layer]
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @AppStorage(BackdropMotion.keepMovingKey) private var keepMoving = false
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isTabSelected) private var isTabSelected
    @State private var isLowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled

    init(primary: Color, secondary: Color, deep: Color, progress: Double = 0) {
        self.progress = progress
        let capped = Palette(
            primary: Self.capped(primary, cap: Theme.Immersive.luminanceCapPrimary),
            secondary: Self.capped(secondary, cap: Theme.Immersive.luminanceCapSecondary),
            deep: Self.capped(deep, cap: Theme.Immersive.luminanceCapDeep)
        )
        self.palette = capped
        self._layers = State(initialValue: [Layer(palette: capped)])
    }

    /// From an `AmbientPalette` ("#rrggbb" strings, as `ArtworkPalette` returns).
    init(palette: AmbientPalette, progress: Double = 0) {
        self.init(
            primary: Self.color(hex: palette.primary),
            secondary: Self.color(hex: palette.secondary),
            deep: Self.color(hex: palette.deep),
            progress: progress
        )
    }

    /// A 6-digit "#rrggbb" (or "rrggbb") string as a colour; the page black when malformed.
    static func color(hex: String) -> Color {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return Theme.background }
        return Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    private var reduceMotion: Bool {
        BackdropMotion.reducesMotion(systemReduceMotion: systemReduceMotion, keepMoving: keepMoving)
    }

    var body: some View {
        ZStack {
            Theme.background
            ForEach(layers) { layer in
                Wash(
                    palette: layer.palette, progress: reduceMotion ? 0 : progress, reduceMotion: reduceMotion,
                    isActive: BackdropMotion.isActive(scenePhase: scenePhase, isTabSelected: isTabSelected, isLowPowerMode: isLowPowerMode)
                )
                    .transition(.opacity)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange).receive(on: DispatchQueue.main)) { _ in
            isLowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
        .onChange(of: palette) { _, new in
            let layer = Layer(palette: new)
            if reduceMotion {
                layers = [layer]
                return
            }
            withAnimation(.easeInOut(duration: Theme.Immersive.backdropCrossFade)) {
                layers.append(layer)
            }
            // Once the new layer is fully in, drop everything beneath it.
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(Theme.Immersive.backdropCrossFade))
                guard let index = layers.firstIndex(where: { $0.id == layer.id }), index > 0 else { return }
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) { layers.removeFirst(index) }
            }
        }
    }

    // MARK: Luminance cap

    /// Darkens a colour until its WCAG relative luminance is within `cap`, as the web's
    /// `artwork-palette.ts` does, so white text on top stays readable.
    private static func capped(_ color: Color, cap: Double) -> Color {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        func luminance(_ scale: Double) -> Double {
            func lin(_ v: CGFloat) -> Double {
                let s = Double(v) * scale
                return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
        }
        guard luminance(1) > cap else { return color }
        var low = 0.0, high = 1.0
        for _ in 0..<20 {
            let mid = (low + high) / 2
            if luminance(mid) > cap { high = mid } else { low = mid }
        }
        return Color(red: Double(r) * low, green: Double(g) * low, blue: Double(b) * low)
    }

    // MARK: One wash

    private struct Wash: View {
        let palette: Palette
        let progress: Double
        let reduceMotion: Bool
        /// False stops the per-frame redraw; the glows stay where they are.
        let isActive: Bool

        var body: some View {
            GeometryReader { geo in
                TimelineView(.animation(paused: reduceMotion || !isActive)) { context in
                    let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate
                    ZStack {
                        LinearGradient(
                            stops: [
                                .init(color: palette.deep, location: 0),
                                .init(color: Theme.background, location: Theme.Immersive.backdropDeepEnd),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        glow(
                            palette.primary, size: geo.size,
                            radius: Theme.Immersive.backdropPrimaryRadius,
                            center: Theme.Immersive.backdropPrimaryCenter,
                            fade: Theme.Immersive.backdropPrimaryFade
                        )
                        .modifier(Drift(
                            t: t, period: Theme.Immersive.driftPeriodPrimary,
                            rotation: Theme.Immersive.driftRotationPrimary,
                            scale: Theme.Immersive.driftScalePrimary
                        ))
                        .rotationEffect(.degrees(progress * Theme.Immersive.scrollTurnPrimary))
                        glow(
                            palette.secondary, size: geo.size,
                            radius: Theme.Immersive.backdropSecondaryRadius,
                            center: Theme.Immersive.backdropSecondaryCenter,
                            fade: Theme.Immersive.backdropSecondaryFade
                        )
                        .modifier(Drift(
                            t: t, period: Theme.Immersive.driftPeriodSecondary,
                            rotation: Theme.Immersive.driftRotationSecondary,
                            scale: Theme.Immersive.driftScaleSecondary
                        ))
                        .rotationEffect(.degrees(-progress * Theme.Immersive.scrollTurnSecondary))
                    }
                }
            }
        }

        /// An elliptical radial glow: a circular gradient stretched to the CSS ellipse radii.
        private func glow(_ color: Color, size: CGSize, radius: CGSize, center: CGPoint, fade: CGFloat) -> some View {
            let unit: CGFloat = 100
            return Rectangle()
                .fill(RadialGradient(
                    colors: [color, color.opacity(0)],
                    center: .center, startRadius: 0, endRadius: unit
                ))
                .frame(width: unit * 2, height: unit * 2)
                .scaleEffect(x: fade * radius.width * size.width / unit, y: fade * radius.height * size.height / unit)
                .position(x: center.x * size.width, y: center.y * size.height)
                .frame(width: size.width, height: size.height)
        }
    }

    /// `alternate` easing between two values: a half-cosine over `period` seconds each way.
    private struct Drift: ViewModifier {
        let t: Double
        let period: Double
        let rotation: (from: Double, to: Double)
        let scale: (from: Double, to: Double)

        func body(content: Content) -> some View {
            let u = (1 - cos(.pi * t / period)) / 2
            return content
                .rotationEffect(.degrees(rotation.from + (rotation.to - rotation.from) * u))
                .scaleEffect(scale.from + (scale.to - scale.from) * u)
        }
    }
}

#if DEBUG
private struct BackdropPreview: View {
    @State private var second = false
    var body: some View {
        ZStack(alignment: .bottom) {
            ArtworkBackdrop(
                primary: second ? Color(red: 0.05, green: 0.30, blue: 0.30) : Color(red: 0.32, green: 0.10, blue: 0.45),
                secondary: second ? Color(red: 0.30, green: 0.18, blue: 0.02) : Color(red: 0.45, green: 0.08, blue: 0.20),
                deep: second ? Color(red: 0.02, green: 0.10, blue: 0.10) : Color(red: 0.12, green: 0.04, blue: 0.16)
            )
            Button(second ? "Palette A" : "Palette B") { second.toggle() }
                .padding()
        }
    }
}

#Preview("Backdrop, two palettes") {
    BackdropPreview()
        .preferredColorScheme(.dark)
}
#endif
