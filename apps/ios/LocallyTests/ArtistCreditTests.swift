import Testing
@testable import Locally

/// The shortening levels of an artist line (#361).
struct ArtistCreditTests {
    private func text(_ features: [String], _ level: Int, main: String = "Mira") -> String {
        ArtistCredit.shortened(main: main, featuring: features, level: level).text
    }

    @Test func noFeaturesIsTheMainNameAtEveryLevel() {
        for level in 0...3 { #expect(text([], level) == "Mira") }
    }

    @Test func oneFeatureHasNoLevelOne() {
        #expect(text(["Okoro"], 0) == "Mira, feat. Okoro")
        #expect(text(["Okoro"], 1) == "Mira, feat. Okoro")
        #expect(text(["Okoro"], 2) == "Mira & 1 more")
    }

    @Test func twoFeaturesShortenInOrder() {
        #expect(text(["Okoro", "Hale"], 0) == "Mira, feat. Okoro & Hale")
        #expect(text(["Okoro", "Hale"], 1) == "Mira, feat. Okoro & 1 more")
        #expect(text(["Okoro", "Hale"], 2) == "Mira & 2 more")
    }

    @Test func fiveFeaturesCountTheRest() {
        let names = ["B", "C", "D", "E", "F"]
        #expect(text(names, 0) == "Mira, feat. B, C, D, E & F")
        #expect(text(names, 1) == "Mira, feat. B & 4 more")
        #expect(text(names, 2) == "Mira & 5 more")
    }

    @Test func levelsOutsideTheRangeClamp() {
        #expect(text(["B", "C"], -1) == text(["B", "C"], 0))
        #expect(text(["B", "C"], 9) == text(["B", "C"], 2))
    }

    @Test func shownNamesKeepTheirLinksAndMoreIsNotOne() {
        let credit = ArtistCredit.shortened(main: "Mira", featuring: ["B", "C", "D"], level: 1)
        #expect(credit.featuring == ["B"])
        #expect(credit.more == 2)
        let attributed = ArtistLink.attributed(credit: credit, linked: true, mainColor: .white, dimColor: .gray)
        let linked = attributed.runs.filter { $0.link != nil }.map { String(attributed[$0.range].characters) }
        #expect(linked == ["Mira", "B"])
    }

    @Test func emptyMainDropsTheLeadingPunctuation() {
        #expect(text([], 0, main: "") == "")
        #expect(text(["B", "C"], 0, main: "") == "feat. B & C")
        #expect(text(["B", "C"], 2, main: "") == "2 more")
    }

    @Test func spokenHoldsEveryName() {
        #expect(ArtistCredit.spoken(main: "Mira", featuring: ["B", "C", "D"]) == "Mira, feat. B, C & D")
    }
}
