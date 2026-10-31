import SwiftUI

/// The Single / Album switch on the import record (docs/design.md "Kind switch"): a `SlimSwitch`
/// with an icon and a word per option, no tint. At accessibility text sizes the options stack, so
/// nothing truncates.
struct KindSwitch: View {
    @Binding var kind: ImportKind

    private static let options: [(value: ImportKind, icon: String?, label: String)] = [
        (.single, "music.note", Copy.Import.kindSingle),
        (.album, "rectangle.stack.fill", Copy.Import.kindAlbum),
    ]

    var body: some View {
        SlimSwitch(options: Self.options, selection: $kind, overflow: .stack)
    }
}
