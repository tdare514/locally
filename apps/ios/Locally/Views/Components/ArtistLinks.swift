import SwiftUI

/// Where an artist page lives in a navigation path (#288). The key is `ArtistNames.artistKey`.
struct ArtistRoute: Hashable {
    let key: String
}

/// The private URLs an artist name carries (#288): `locally-artist://open?key=<percent-encoded key>`.
/// An `openURL` action at the stack level turns one into an `ArtistRoute`, so a tap never leaves
/// the app.
enum ArtistLink {
    static let scheme = "locally-artist"

    /// The link for a name, or nil when the name has no key.
    static func url(forName name: String) -> URL? {
        let key = ArtistNames.artistKey(name)
        guard !key.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = scheme
        components.host = "open"
        components.queryItems = [URLQueryItem(name: "key", value: key)]
        return components.url
    }

    /// The artist key a link carries; nil for any other URL.
    static func key(from url: URL) -> String? {
        guard url.scheme == scheme, let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let key = components.queryItems?.first { $0.name == "key" }?.value
        return key.flatMap { $0.isEmpty ? nil : $0 }
    }

    /// An artist line "A, feat. B & C": the main name, then the "feat." part and its names dimmed.
    /// With `linked`, each name is its own link ("," and "&" are not). Pure text when not linked.
    static func attributed(
        main: String, featuring: [String], linked: Bool, linkMain: Bool = true,
        mainColor: Color, dimColor: Color
    ) -> AttributedString {
        var result = AttributedString()
        func run(_ text: String, color: Color, link: String? = nil) {
            var piece = AttributedString(text)
            piece.foregroundColor = color
            if linked, let link, let url = url(forName: link) { piece.link = url }
            result.append(piece)
        }
        run(main, color: mainColor, link: linkMain ? main : nil)
        guard !featuring.isEmpty else { return result }
        run(", feat. ", color: dimColor)
        for (index, name) in featuring.enumerated() {
            if index > 0 { run(index == featuring.count - 1 ? " & " : ", ", color: dimColor) }
            run(name, color: dimColor, link: name)
        }
        return result
    }

    /// The dim "feat. B & C" that follows a track title, each name its own link.
    static func featuringSuffix(_ names: [String], linked: Bool, color: Color) -> AttributedString {
        var result = AttributedString()
        func run(_ text: String, link: String? = nil) {
            var piece = AttributedString(text)
            piece.foregroundColor = color
            if linked, let link, let url = url(forName: link) { piece.link = url }
            result.append(piece)
        }
        run("feat. ")
        for (index, name) in names.enumerated() {
            if index > 0 { run(index == names.count - 1 ? " & " : ", ") }
            run(name, link: name)
        }
        return result
    }

    /// "B, C" as the Featuring row words it, each name its own link.
    static func featuringList(_ names: [String], linked: Bool, color: Color) -> AttributedString {
        var result = AttributedString()
        for (index, name) in names.enumerated() {
            var piece = AttributedString(index > 0 ? ", " : "")
            piece.foregroundColor = color
            result.append(piece)
            var link = AttributedString(name)
            link.foregroundColor = color
            if linked, let url = url(forName: name) { link.link = url }
            result.append(link)
        }
        return result
    }
}

/// One artist line, "A, feat. B & C", with a link on every name when `linked`. It wraps like any
/// text, and VoiceOver reads each name as a link (the Links rotor).
struct ArtistLineText: View {
    let main: String
    var featuring: [String] = []
    var linked = true
    /// False for a placeholder main name ("Unknown artist") that is no artist to open.
    var linkMain = true
    var font: Font = .subheadline
    var mainColor: Color = Theme.secondaryText
    var dimColor: Color = Theme.secondaryText
    var lineLimit: Int?

    var body: some View {
        Text(ArtistLink.attributed(main: main, featuring: featuring, linked: linked, linkMain: linkMain, mainColor: mainColor, dimColor: dimColor))
            .font(font)
            .lineLimit(lineLimit)
            .tint(mainColor)
            .fixedSize(horizontal: false, vertical: true)
    }
}

extension View {
    /// Opens an artist's page when one of their links is tapped, and never lets the URL leave the
    /// app. Put it on the `NavigationStack` itself so pushed pages inherit it.
    func artistLinks(open: @escaping (ArtistRoute) -> Void) -> some View {
        environment(\.openURL, OpenURLAction { url in
            guard let key = ArtistLink.key(from: url) else { return .systemAction }
            open(ArtistRoute(key: key))
            return .handled
        })
    }
}
