import SwiftUI

/// The collection's cover as a record sleeve with the vinyl peeking out to its right (#369), like the release page's.
/// Outside edit mode the sleeve is the play control: a tap starts, pauses or resumes the collection, acknowledged by
/// one soft sweep of light (a short brightening under Reduce Motion) and a light tap, with no glyph on the cover.
/// The disc turns only while this collection plays, and holds its angle on pause (`RecordSpin`, as the record player does).
struct CollectionSleeveView: View {
    let model: CollectionsModel
    let collection: MusicCollection
    var isEditing = false
    /// The sleeve's side; the record player's queue header shows a small one.
    var side: CGFloat = Theme.Immersive.sleeveSizeCompact

    @Environment(\.playback) private var playback

    /// The first cover, once loaded: the disc's label.
    @State private var firstImage: UIImage?

    /// The side that fits `availableWidth` with the disc's peek, keeping the cover-to-disc ratio.
    static func fittedSide(_ side: CGFloat, availableWidth: CGFloat) -> CGFloat {
        SpinningSleeveFit.fittedSide(side, availableWidth: availableWidth)
    }

    var body: some View {
        let control = CollectionPlayControl(model: model, id: collection.id, playback: playback)
        let action = control.sleeveAction(isEditing: isEditing)
        let canPlay = !control.playQueue.isEmpty
        SpinningSleeve(
            side: side, discCover: firstImage, isPlaying: control.isPlayingNow, isInert: action == .inert, isEditing: isEditing,
            fitsWidth: side >= Theme.Immersive.sleeveSizeCompact,
            label: action.label(name: collection.name, canPlay: canPlay), hint: action.hint,
            onPress: { control.togglePlay() }
        ) { side in
            CollectionCoverView(releaseIDs: model.coverReleaseIDs(of: collection), side: side,
                                cornerRadius: Theme.Immersive.sleeveCornerRadius) { firstImage = $0 }
        }
    }
}
