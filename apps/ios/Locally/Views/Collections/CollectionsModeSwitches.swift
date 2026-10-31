import SwiftUI

/// The two per-device choices at the top of the Collections screen (#352): Record player / List, and (in the record
/// player) Picture disc / Black vinyl, as icon toggles like the Library's layout toggle (`IconToggle`, #444). Side by
/// side when they fit, else stacked. Both are remembered by the screen that owns the bindings; each icon keeps the old
/// words as its accessibility label.
struct CollectionsModeSwitches: View {
    @Binding var mode: CollectionsViewMode
    @Binding var record: SpinningRecord

    private var modeToggle: some View {
        IconToggle(
            options: [
                IconToggleOption(CollectionsViewMode.player, label: Copy.Collections.viewRecordPlayer) { RecordPlayerGlyph(size: $0) },
                IconToggleOption(.list, icon: .list, label: Copy.Collections.viewList),
            ],
            selection: $mode, label: Copy.Collections.viewSwitchName
        )
    }

    private var recordToggle: some View {
        IconToggle(
            options: [
                IconToggleOption(SpinningRecord.picture, label: Copy.Collections.pictureDisc) { PictureDiscSwatch(size: $0) },
                IconToggleOption(.vinyl, label: Copy.Collections.blackVinyl) { BlackVinylSwatch(size: $0) },
            ],
            selection: $record, label: Copy.Collections.recordSwitchName
        )
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                modeToggle
                if mode == .player { recordToggle }
            }
            VStack(alignment: .leading, spacing: 8) {
                modeToggle
                if mode == .player { recordToggle }
            }
        }
    }
}

/// The glyphs below are drawn on the `Icon/…` set's 24-unit grid (`u` is one unit at `size`): a 2-unit stroke, the
/// circle's outer edge 19 units across, 2-unit gaps between the rings.

/// A turntable from above in the drawn set's style: the plinth, the platter with its spindle, and the tonearm from its
/// pivot at the top right to the record's edge. Kept apart from the record swatches beside it, which are discs alone. A
/// template: it takes the toggle's selected / unselected colour.
private struct RecordPlayerGlyph: View {
    let size: CGFloat

    var body: some View {
        let u = size / 24
        ZStack {
            TurntableShape().stroke(style: StrokeStyle(lineWidth: 2 * u, lineCap: .round, lineJoin: .round))
            Circle().frame(width: 2.5 * u, height: 2.5 * u).offset(x: -2 * u)
        }
        .frame(width: size, height: size)
    }
}

private struct TurntableShape: Shape {
    func path(in rect: CGRect) -> Path {
        let u = rect.width / 24
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * u, y: rect.minY + y * u) }
        var path = Path()
        path.addRoundedRect(in: CGRect(origin: point(2.5, 4.5), size: CGSize(width: 19 * u, height: 15 * u)), cornerSize: CGSize(width: 3 * u, height: 3 * u))
        path.addEllipse(in: CGRect(origin: point(5, 7), size: CGSize(width: 10 * u, height: 10 * u)))
        path.move(to: point(18.5, 7.5))
        path.addLine(to: point(18.5, 12.5))
        path.addLine(to: point(14.5, 15))
        return path
    }
}

/// Picture disc: a disc in the accent-to-pink wash with a small dark centre hole.
private struct PictureDiscSwatch: View {
    let size: CGFloat

    var body: some View {
        let u = size / 24
        ZStack {
            Circle()
                .fill(LinearGradient(colors: Theme.Immersive.pictureSwatchColors, startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 19 * u, height: 19 * u)
            Circle().fill(Color.black).frame(width: 4 * u, height: 4 * u)
        }
        .frame(width: size, height: size)
    }
}

/// Black vinyl: a near-black disc with a 1 pt light rim, one faint groove ring and a small light label dot. The
/// rim, ring and dot take the toggle's selected / unselected colour.
private struct BlackVinylSwatch: View {
    let size: CGFloat

    var body: some View {
        let u = size / 24
        ZStack {
            Circle().fill(Theme.Immersive.discColor).frame(width: 19 * u, height: 19 * u)
            Circle().strokeBorder(lineWidth: 1).frame(width: 19 * u, height: 19 * u)
            Circle().strokeBorder(lineWidth: 1).opacity(0.3).frame(width: 12 * u, height: 12 * u)
            Circle().frame(width: 5 * u, height: 5 * u)
        }
        .frame(width: size, height: size)
    }
}
