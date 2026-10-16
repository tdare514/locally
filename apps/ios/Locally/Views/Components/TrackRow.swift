import SwiftUI

/// A track row, after the Mac's `TrackList` row: the number, the title (an inline field or plain
/// text), then at the trailing edge the plays, a replace button and the drag grip. Every piece is
/// optional, so the single, the album and the release page share it. It draws no background of
/// its own; it sits inside a panel that supplies the fill and the hairlines.
struct TrackRow: View {
    var number: Int?
    let title: String
    /// Set for an editable title (an album's); nil shows the title as plain text.
    var titleBinding: Binding<String>?
    var plays: String?
    /// The track's length (`m:ss`) and the same in words for VoiceOver; left out when unknown.
    var length: String?
    var lengthSpoken: String?
    var onReplace: (() -> Void)?
    var showsGrip = false

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric private var numberWidth = Theme.Track.numberWidth

    var body: some View {
        HStack(spacing: Theme.Track.spacing) {
            // The number sits on the title's baseline, as on the Mac, not centred against the field.
            HStack(alignment: .firstTextBaseline, spacing: Theme.Track.spacing) {
                if let number {
                    Text("\(number)")
                        .font(Theme.ScaledFont.trackNumber)
                        .foregroundStyle(.white.opacity(Theme.Track.numberOpacity))
                        // A fixed column keeps the titles in line; at the accessibility sizes the
                        // number takes only its own width, so the title keeps the room.
                        .frame(width: dynamicTypeSize.isAccessibilitySize ? nil : numberWidth, alignment: .leading)
                        .fixedSize()
                }
                if dynamicTypeSize.isAccessibilitySize {
                    // At the accessibility sizes the plays sit under the title, so neither is squeezed.
                    VStack(alignment: .leading, spacing: 2) {
                        titleView
                        playsView
                    }
                } else {
                    titleView
                    playsView
                }
            }
            lengthView
            if let onReplace {
                Button(action: onReplace) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(Theme.ScaledFont.subheadline)
                        .foregroundStyle(.white.opacity(Theme.Track.replaceOpacity))
                        .frame(width: Theme.Track.replaceHitSize, height: Theme.Track.replaceHitSize)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Copy.Import.replaceTrack(title))
            }
            if showsGrip {
                Image(systemName: "line.3.horizontal")
                    .font(Theme.ScaledFont.subheadline)
                    .foregroundStyle(.white.opacity(Theme.Track.gripOpacity))
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: Theme.Track.minHeight)
        // View mode (nothing to edit) reads as one element; edit mode keeps its fields as stops.
        .accessibilityElement(children: titleBinding == nil && onReplace == nil && !showsGrip ? .combine : .contain)
        .accessibilityIdentifier(number.map { "track-row-\($0)" } ?? "track-row")
    }

    @ViewBuilder private var lengthView: some View {
        if let length {
            Text(length)
                .font(Theme.ScaledFont.subheadline)
                .monospacedDigit()
                .foregroundStyle(.white.opacity(Theme.Track.lengthOpacity))
                .lineLimit(1)
                .fixedSize()
                .accessibilityLabel(lengthSpoken ?? length)
        }
    }

    @ViewBuilder private var playsView: some View {
        if let plays {
            Text(plays)
                .font(Theme.ScaledFont.trackNumber)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
                .fixedSize(horizontal: !dynamicTypeSize.isAccessibilitySize, vertical: false)
        }
    }

    @ViewBuilder private var titleView: some View {
        if let titleBinding {
            // Wraps at the accessibility sizes rather than cutting the title to a few letters.
            InlineField(Copy.Import.track, text: titleBinding, font: Theme.ScaledFont.trackTitle, wraps: dynamicTypeSize.isAccessibilitySize)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(title)
                .font(Theme.ScaledFont.trackTitle)
                .foregroundStyle(Theme.primaryText)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
