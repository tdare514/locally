import SwiftUI

/// The Single / Album switch on the import record (docs/design.md "Kind switch"): a `GlowSwitch`
/// with an icon and a word per option, its thumb tinted with the cover's colour. At accessibility
/// text sizes the options stack, so nothing truncates.
struct KindSwitch: View {
    @Binding var kind: ImportKind
    let tint: Color

    private static let options: [(value: ImportKind, icon: String?, label: String)] = [
        (.single, "music.note", Copy.Import.kindSingle),
        (.album, "rectangle.stack.fill", Copy.Import.kindAlbum),
    ]

    var body: some View {
        GlowSwitch(options: Self.options, selection: $kind, tint: tint, overflow: .stack)
    }
}
