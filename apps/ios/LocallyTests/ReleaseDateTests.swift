import Foundation
import Testing
@testable import Locally

struct ReleaseDateTests {
    @Test func eachPrecisionParses() throws {
        let year = try #require(ReleaseDate("2024"))
        #expect(year.year == 2024 && year.month == nil && year.day == nil)
        let month = try #require(ReleaseDate("2024-05"))
        #expect(month.year == 2024 && month.month == 5 && month.day == nil)
        let day = try #require(ReleaseDate(" 2024-05-17 "))
        #expect(day.year == 2024 && day.month == 5 && day.day == 17)
        #expect(ReleaseDate("0999")?.yearString == "0999")
    }

    @Test(arguments: ["2024-13", "2023-02-29", "2024-02-30", "2024-5", "24", "2024-05-17x", "", "2024-00", "2024-04-31", "٢٠٢٤", "2024-"])
    func rejectsWhatIsNotARealDate(text: String) {
        #expect(ReleaseDate(text) == nil, "\(text)")
    }

    @Test func acceptsALeapDay() {
        #expect(ReleaseDate("2024-02-29") != nil)
        #expect(ReleaseDate("2000-02-29") != nil)
        #expect(ReleaseDate("1900-02-29") == nil)
    }

    @Test func aDayNeverExistsWithoutAMonth() {
        #expect(ReleaseDate(year: 2024, month: nil, day: 5) == nil)
        #expect(ReleaseDate(year: 10000) == nil)
        #expect(ReleaseDate(year: -1) == nil)
    }

    @Test func fromTagKeepsTheLeadingDate() {
        #expect(ReleaseDate.fromTag("2024-05-17T07:00:00Z")?.isoString == "2024-05-17")
        #expect(ReleaseDate.fromTag("2024-05-17")?.isoString == "2024-05-17")
        #expect(ReleaseDate.fromTag("2024-05")?.isoString == "2024-05")
        #expect(ReleaseDate.fromTag("2024")?.isoString == "2024")
        #expect(ReleaseDate.fromTag("2024-13-01")?.isoString == "2024")
        #expect(ReleaseDate.fromTag("2024-13-40")?.isoString == "2024")
        #expect(ReleaseDate.fromTag("2023-02-29")?.isoString == "2023-02", "not a real day, so the month")
        #expect(ReleaseDate.fromTag("May 2024") == nil)
        #expect(ReleaseDate.fromTag("20245") == nil)
        #expect(ReleaseDate.fromTag("") == nil)
    }

    @Test func storedUsesTheDateOnlyWhenItAgreesWithTheYear() {
        #expect(ReleaseDate.stored(year: "2024", releaseDate: "2024-05-17")?.isoString == "2024-05-17")
        #expect(ReleaseDate.stored(year: "2024", releaseDate: "2024-05")?.isoString == "2024-05")
        #expect(ReleaseDate.stored(year: "2023", releaseDate: "2024-05-17")?.isoString == "2023")
        #expect(ReleaseDate.stored(year: "2024", releaseDate: "2024-02-30")?.isoString == "2024")
        #expect(ReleaseDate.stored(year: "2024", releaseDate: "nonsense")?.isoString == "2024")
        #expect(ReleaseDate.stored(year: "2024", releaseDate: "2024")?.isoString == "2024")
        #expect(ReleaseDate.stored(year: "2024", releaseDate: nil)?.isoString == "2024")
        #expect(ReleaseDate.stored(year: nil, releaseDate: "2024-05-17") == nil)
        #expect(ReleaseDate.stored(year: "soon", releaseDate: nil) == nil)
        #expect(ReleaseDate.stored(year: "24", releaseDate: nil) == nil)
    }

    @Test func formatsInEnGB() throws {
        let gb = Locale(identifier: "en_GB")
        #expect(try #require(ReleaseDate("2024-05-17")).formatted(locale: gb) == "17 May 2024")
        #expect(try #require(ReleaseDate("2024-05")).formatted(locale: gb) == "May 2024")
        #expect(try #require(ReleaseDate("2024")).formatted(locale: gb) == "2024")
    }

    @Test func formatsInEnUS() throws {
        let us = Locale(identifier: "en_US")
        #expect(try #require(ReleaseDate("2024-05-17")).formatted(locale: us) == "May 17, 2024")
        #expect(try #require(ReleaseDate("2024-05")).formatted(locale: us) == "May 2024")
        #expect(try #require(ReleaseDate("2024")).formatted(locale: us) == "2024")
    }

    @Test func yearAndReleaseDateAreDerivedTogether() throws {
        let day = try #require(ReleaseDate("2024-05-17"))
        #expect(day.yearString == "2024" && day.releaseDateString == "2024-05-17" && day.isoString == "2024-05-17")
        let month = try #require(ReleaseDate("2024-05"))
        #expect(month.yearString == "2024" && month.releaseDateString == "2024-05")
        let year = try #require(ReleaseDate("2024"))
        #expect(year.yearString == "2024" && year.releaseDateString == nil && year.isoString == "2024")

        var release = Release(kind: .single, title: "T", artist: "A", year: "1999", releaseDate: "1999-01-02", folderPath: "/x", tracks: [])
        release.date = day
        #expect(release.year == "2024" && release.releaseDate == "2024-05-17")
        release.date = year
        #expect(release.year == "2024" && release.releaseDate == nil)
        release.date = nil
        #expect(release.year == nil && release.releaseDate == nil)
    }

    @Test func aReleaseSavedBeforeTheKeyExistedStillDecodes() throws {
        var release = Release(kind: .single, title: "T", artist: "A", year: "2020", folderPath: "/x", tracks: [])
        release.date = ReleaseDate(year: 2020, month: 3)
        let data = try JSONEncoder().encode(release)
        var object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object.removeValue(forKey: "releaseDate")
        let old = try JSONDecoder().decode(Release.self, from: JSONSerialization.data(withJSONObject: object))
        #expect(old.releaseDate == nil && old.date?.isoString == "2020")
    }
}
