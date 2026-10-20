import Foundation
import Testing
@testable import Locally

/// What a person may type into the Release date field (#221), in a day-first and a month-first language.
struct ReleaseDateTextTests {
    private let gb = Locale(identifier: "en_GB")
    private let us = Locale(identifier: "en_US")

    private func date(_ y: Int, _ m: Int? = nil, _ d: Int? = nil) -> ReleaseDateEntry {
        .date(ReleaseDate(year: y, month: m, day: d)!)
    }

    @Test(arguments: ["en_GB", "en_US"])
    func readsTheIsoForms(_ id: String) {
        let locale = Locale(identifier: id)
        #expect(ReleaseDateText.parse("2024", locale: locale) == date(2024))
        #expect(ReleaseDateText.parse("2024-05", locale: locale) == date(2024, 5))
        #expect(ReleaseDateText.parse("2024-05-17", locale: locale) == date(2024, 5, 17))
        #expect(ReleaseDateText.parse("  2024-05-17 \n", locale: locale) == date(2024, 5, 17))
    }

    @Test(arguments: ["en_GB", "en_US"])
    func blankIsEmpty(_ id: String) {
        let locale = Locale(identifier: id)
        #expect(ReleaseDateText.parse("", locale: locale) == .empty)
        #expect(ReleaseDateText.parse("   ", locale: locale) == .empty)
    }

    @Test(arguments: ["en_GB", "en_US", "de_DE", "fr_FR", "ru_RU", "ja_JP", "zh_Hans_CN", "ar_EG", "th_TH"])
    func whatFormattedPrintsRoundTripsAtEveryPrecision(_ id: String) {
        let locale = Locale(identifier: id)
        for original in [ReleaseDate(year: 2024)!, ReleaseDate(year: 2024, month: 5)!, ReleaseDate(year: 2024, month: 5, day: 17)!,
                         ReleaseDate(year: 1999, month: 12, day: 1)!, ReleaseDate(year: 2024, month: 9, day: 3)!, ReleaseDate(year: 2024, month: 2, day: 29)!] {
            #expect(ReleaseDateText.parse(original.formatted(locale: locale), locale: locale) == .date(original), "\(original.formatted(locale: locale))")
        }
    }

    @Test func readsMonthNames() {
        #expect(ReleaseDateText.parse("17 May 2024", locale: gb) == date(2024, 5, 17))
        #expect(ReleaseDateText.parse("May 17, 2024", locale: us) == date(2024, 5, 17))
        #expect(ReleaseDateText.parse("May 2024", locale: gb) == date(2024, 5))
        #expect(ReleaseDateText.parse("May 2024", locale: us) == date(2024, 5))
        #expect(ReleaseDateText.parse("17 may 2024", locale: gb) == date(2024, 5, 17))
        #expect(ReleaseDateText.parse("17 MAY 2024", locale: gb) == date(2024, 5, 17))
        #expect(ReleaseDateText.parse("3 Sep 2024", locale: gb) == date(2024, 9, 3))
        #expect(ReleaseDateText.parse("3 Sep. 2024", locale: gb) == date(2024, 9, 3))
        #expect(ReleaseDateText.parse("Sep. 3, 2024", locale: us) == date(2024, 9, 3))
        #expect(ReleaseDateText.parse("17 September 2024", locale: gb) == date(2024, 9, 17))
        #expect(ReleaseDateText.parse("17 Dec 2024.", locale: gb) == date(2024, 12, 17))
    }

    @Test func ignoresAccentsInMonthNames() {
        let fr = Locale(identifier: "fr_FR")
        #expect(ReleaseDateText.parse("12 fevrier 2024", locale: fr) == date(2024, 2, 12))
        #expect(ReleaseDateText.parse("12 Février 2024", locale: fr) == date(2024, 2, 12))
        #expect(ReleaseDateText.parse("12 DECEMBRE 2024", locale: fr) == date(2024, 12, 12))
    }

    @Test func readsNumericDatesInTheLocalesOrder() {
        #expect(ReleaseDateText.parse("17/05/2024", locale: gb) == date(2024, 5, 17))
        #expect(ReleaseDateText.parse("05/17/2024", locale: us) == date(2024, 5, 17))
        #expect(ReleaseDateText.parse("17.05.2024", locale: gb) == date(2024, 5, 17))
        #expect(ReleaseDateText.parse("17-05-2024", locale: gb) == date(2024, 5, 17))
        #expect(ReleaseDateText.parse("17 05 2024", locale: gb) == date(2024, 5, 17))
        #expect(ReleaseDateText.parse("5/7/2024", locale: gb) == date(2024, 7, 5))
        #expect(ReleaseDateText.parse("5/7/2024", locale: us) == date(2024, 5, 7))
    }

    @Test func readsMonthAndYear() {
        #expect(ReleaseDateText.parse("05/2024", locale: gb) == date(2024, 5))
        #expect(ReleaseDateText.parse("05/2024", locale: us) == date(2024, 5))
        #expect(ReleaseDateText.parse("5.2024", locale: gb) == date(2024, 5))
        #expect(ReleaseDateText.parse("2024/5", locale: us) == date(2024, 5))
    }

    @Test(arguments: ["en_GB", "en_US"])
    func datesWithTheShapeOfADateThatDoNotExistAreImpossible(_ id: String) {
        let locale = Locale(identifier: id)
        #expect(ReleaseDateText.parse("2023-02-29", locale: locale) == .impossible)
        #expect(ReleaseDateText.parse("2024-13", locale: locale) == .impossible)
        #expect(ReleaseDateText.parse("2024-00", locale: locale) == .impossible)
        #expect(ReleaseDateText.parse("2024-04-31", locale: locale) == .impossible)
        #expect(ReleaseDateText.parse("30 February 2024", locale: locale) == .impossible)
        #expect(ReleaseDateText.parse("February 30, 2024", locale: locale) == .impossible)
        #expect(ReleaseDateText.parse("13/2024", locale: locale) == .impossible)
    }

    @Test func numericDatesOutOfTheLocalesOrderAreImpossible() {
        #expect(ReleaseDateText.parse("31/02/2024", locale: gb) == .impossible)
        #expect(ReleaseDateText.parse("02/31/2024", locale: us) == .impossible)
        #expect(ReleaseDateText.parse("17/05/2024", locale: us) == .impossible)
        #expect(ReleaseDateText.parse("05/17/2024", locale: gb) == .impossible)
        #expect(ReleaseDateText.parse("00/05/2024", locale: gb) == .impossible)
    }

    @Test func leapDaysFollowTheGregorianRule() {
        #expect(ReleaseDateText.parse("29/02/2024", locale: gb) == date(2024, 2, 29))
        #expect(ReleaseDateText.parse("29/02/2023", locale: gb) == .impossible)
        #expect(ReleaseDateText.parse("29/02/1900", locale: gb) == .impossible)
        #expect(ReleaseDateText.parse("29/02/2000", locale: gb) == date(2000, 2, 29))
    }

    @Test(arguments: ["en_GB", "en_US"])
    func anythingElseIsUnreadable(_ id: String) {
        let locale = Locale(identifier: id)
        for text in ["soon", "2", "24", "202", "20245", "17 Mayo 2024", "May", "17 May 24", "May 17", "5/17", "1/2/3", "2024-05-17-01", "17th May 2024",
                     "-2024", "2024-", "2024/05/17 12:00", "٢٠٢٤", "17 May 2024 AD", "2024 05 17 03"] {
            #expect(ReleaseDateText.parse(text, locale: locale) == .unreadable, "\(text)")
        }
    }
}

/// A date printed by the locale reads back when its case or accents differ (#221).
struct ReleaseDateTextCaseTests {
    @Test(arguments: ["ru_RU", "de_DE", "fr_FR", "en_GB"])
    func upperCasedFormattedTextStillReads(_ id: String) {
        let locale = Locale(identifier: id)
        for original in [ReleaseDate(year: 2024, month: 5)!, ReleaseDate(year: 2024, month: 5, day: 17)!, ReleaseDate(year: 2024, month: 9, day: 3)!] {
            let shouted = original.formatted(locale: locale).uppercased(with: locale)
            #expect(ReleaseDateText.parse(shouted, locale: locale) == .date(original), "\(shouted)")
        }
    }

    @Test func russianUpperCaseReads() {
        let ru = Locale(identifier: "ru_RU")
        #expect(ReleaseDateText.parse("17 МАЯ 2024\u{202F}г.", locale: ru) == .date(ReleaseDate(year: 2024, month: 5, day: 17)!))
        let month = ReleaseDate(year: 2024, month: 5)!
        #expect(ReleaseDateText.parse(month.formatted(locale: ru).uppercased(with: ru), locale: ru) == .date(month))
    }

    @Test func russianTypedWithPlainSpacesReads() {
        let ru = Locale(identifier: "ru_RU")
        #expect(ReleaseDateText.parse("17 мая 2024 г.", locale: ru) == .date(ReleaseDate(year: 2024, month: 5, day: 17)!))
    }

    @Test func lenientParsingNeverRollsAnImpossibleDateOver() {
        let gb = Locale(identifier: "en_GB")
        #expect(ReleaseDateText.parse("31 February 2024", locale: gb) == .impossible)
        #expect(ReleaseDateText.parse("31/02/2024", locale: gb) == .impossible)
        #expect(ReleaseDateText.parse("30 Feb 2024", locale: gb).date == nil)
    }

    @Test func englishUpperCaseAndImpossibleDatesStillBehave() {
        let gb = Locale(identifier: "en_GB")
        #expect(ReleaseDateText.parse("17 MAY 2024", locale: gb) == .date(ReleaseDate(year: 2024, month: 5, day: 17)!))
        #expect(ReleaseDateText.parse("31/02/2024", locale: gb) == .impossible)
    }
}
