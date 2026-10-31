import SwiftUI

/// The Mac's `MusicNoteIcon` (`apps/web/src/components/Icons.tsx`): a beamed pair of notes. No SF
/// Symbol draws it (`music.note` is one note), so the path is drawn here in the same 24-unit box:
/// `M9 18V5l12-2v13` and circles at (6,18) and (18,16), radius 3. Stroke it round, at 1.8 units.
struct MusicNoteShape: Shape {
    func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height)
        let unit = side / 24
        let originX = rect.midX - side / 2
        let originY = rect.midY - side / 2
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: originX + x * unit, y: originY + y * unit)
        }
        var path = Path()
        path.move(to: point(9, 18))
        path.addLine(to: point(9, 5))
        path.addLine(to: point(21, 3))
        path.addLine(to: point(21, 16))
        for (cx, cy) in [(CGFloat(6), CGFloat(18)), (CGFloat(18), CGFloat(16))] {
            path.addEllipse(in: CGRect(x: originX + (cx - 3) * unit, y: originY + (cy - 3) * unit, width: 6 * unit, height: 6 * unit))
        }
        return path
    }
}

/// The double note, stroked like the Mac's icon (1.8 of 24, round caps and joins).
struct MusicNoteGlyph: View {
    var color: Color = Theme.textDim

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            MusicNoteShape()
                .stroke(color, style: StrokeStyle(lineWidth: side * 1.8 / 24, lineCap: .round, lineJoin: .round))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

/// A release with no art (#296): the `card` square with the double note centred in `text-dim`,
/// about a third of the square on large sleeves and a little more on small ones so it still reads.
/// It fills whatever frame it is given and draws no corner of its own.
struct NoCoverArt: View {
    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            ZStack {
                Theme.card
                MusicNoteGlyph()
                    .frame(width: side * Self.glyphRatio(forSide: side), height: side * Self.glyphRatio(forSide: side))
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .accessibilityHidden(true)
    }

    /// One third from 120 pt up, 0.45 under 64 pt, easing between.
    static func glyphRatio(forSide side: CGFloat) -> CGFloat {
        if side >= 120 { return 1.0 / 3 }
        if side <= 64 { return 0.45 }
        return 0.45 - (0.45 - 1.0 / 3) * (side - 64) / 56
    }
}

#if DEBUG
#Preview("No cover") {
    HStack(spacing: 16) {
        NoCoverArt().frame(width: 48, height: 48).clipShape(RoundedRectangle(cornerRadius: Theme.Radius.thumbnail))
        NoCoverArt().frame(width: 200, height: 200).clipShape(RoundedRectangle(cornerRadius: 4))
    }
    .padding()
    .background(Theme.background)
}
#endif
