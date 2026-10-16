import Foundation
import Testing
@testable import Locally

/// Ports the cases of `apps/web/tests/unit/play-periods.test.ts` that apply to the phone: the
/// web's `periodRange(period, today, firstDay)` is `selectionRange` at back 0 here.
struct PlayPeriodsTests {
    private let mon = 1
    private let sun = 7
    private let sat = 6

    private func range(_ kind: StatsPeriodKind, _ back: Int, _ today: String, _ first: Int = 1) -> DayRange {
        PlayPeriods.selectionRange(PeriodSelection(kind: kind, back: back), today: today, firstDay: first)
    }

    private func r(_ from: String, _ to: String) -> DayRange { DayRange(from: from, to: to) }

    // MARK: - back 0: today, week, month, year

    @Test func todayIsTheOneDay() {
        #expect(range(.today, 0, "2026-10-15") == r("2026-10-15", "2026-10-15"))
        #expect(range(.today, 0, "2026-03-05") == r("2026-03-05", "2026-03-05"))
    }

    @Test func weekStartsOnTheFirstDay() {
        let thursday = "2026-10-15"
        #expect(range(.week, 0, thursday) == r("2026-10-12", thursday))
        #expect(range(.week, 0, thursday, mon) == r("2026-10-12", thursday))
        #expect(range(.week, 0, thursday, sun) == r("2026-10-11", thursday))
        #expect(range(.week, 0, thursday, sat) == r("2026-10-10", thursday))
    }

    @Test func weekIsJustTodayOnItsFirstDayAndAWholeWeekOnItsLast() {
        #expect(range(.week, 0, "2026-10-12", mon) == r("2026-10-12", "2026-10-12"))
        #expect(range(.week, 0, "2026-10-11", sun) == r("2026-10-11", "2026-10-11"))
        #expect(range(.week, 0, "2026-10-18", mon) == r("2026-10-12", "2026-10-18"))
        #expect(range(.week, 0, "2026-10-17", sun) == r("2026-10-11", "2026-10-17"))
        #expect(range(.week, 0, "2026-10-11", mon) == r("2026-10-05", "2026-10-11"))
    }

    @Test func weekCrossesMonthYearAndLeapDay() {
        #expect(range(.week, 0, "2026-03-01", mon) == r("2026-02-23", "2026-03-01"))
        #expect(range(.week, 0, "2026-03-04", sun) == r("2026-03-01", "2026-03-04"))
        #expect(range(.week, 0, "2027-01-01", mon) == r("2026-12-28", "2027-01-01"))
        #expect(range(.week, 0, "2028-03-01", mon) == r("2028-02-28", "2028-03-01"))
        #expect(range(.week, 0, "2028-03-02", mon).from == "2028-02-28")
    }

    @Test func weekIsNotThrownByClockChanges() {
        #expect(range(.week, 0, "2026-11-02", sun) == r("2026-11-01", "2026-11-02"))
        #expect(range(.week, 0, "2026-11-03", mon) == r("2026-11-02", "2026-11-03"))
        #expect(range(.week, 0, "2026-03-09", sun) == r("2026-03-08", "2026-03-09"))
        #expect(range(.week, 0, "2026-03-08", mon) == r("2026-03-02", "2026-03-08"))
    }

    @Test func aFirstDayItCannotUseIsMonday() {
        for bad in [0, 8, -1] {
            #expect(range(.week, 0, "2026-10-15", bad) == r("2026-10-12", "2026-10-15"))
        }
    }

    @Test func monthRunsFromTheFirstToToday() {
        #expect(range(.month, 0, "2026-10-15") == r("2026-10-01", "2026-10-15"))
        #expect(range(.month, 0, "2026-10-01") == r("2026-10-01", "2026-10-01"))
        #expect(range(.month, 0, "2026-10-15", sun) == r("2026-10-01", "2026-10-15"))
        #expect(range(.month, 0, "2026-12-31") == r("2026-12-01", "2026-12-31"))
        #expect(range(.month, 0, "2027-01-01") == r("2027-01-01", "2027-01-01"))
    }

    @Test func currentPeriodsEndTodayAndYearStartsJanuaryFirst() {
        let today = "2026-10-15"
        #expect(range(.year, 0, today) == r("2026-01-01", today))
    }

    // MARK: - stepping back

    @Test func stepsBackAWholeDayWeekMonthOrYear() {
        let today = "2026-10-15"
        #expect(range(.today, 2, today) == r("2026-10-13", "2026-10-13"))
        #expect(range(.week, 1, today, mon) == r("2026-10-05", "2026-10-11"))
        #expect(range(.week, 2, today, sun) == r("2026-09-27", "2026-10-03"))
        #expect(range(.month, 1, today) == r("2026-09-01", "2026-09-30"))
        #expect(range(.month, 10, today) == r("2025-12-01", "2025-12-31"))
        #expect(range(.year, 1, today) == r("2025-01-01", "2025-12-31"))
    }

    @Test func knowsFebruaryInALeapYear() {
        #expect(range(.month, 1, "2028-03-10") == r("2028-02-01", "2028-02-29"))
    }

    @Test func allTimeAsksForTheLongestRangeEndingToday() {
        let today = "2026-10-15"
        let all = range(.all, 0, today)
        #expect(all.to == today)
        #expect(all.from == PlayPeriods.addDays(today, 1 - PlayPeriods.maxRangeDays))
    }

    @Test func aNegativeBackIsReadAsZero() {
        #expect(range(.week, -3, "2026-10-15") == range(.week, 0, "2026-10-15"))
    }

    // MARK: - canStepBack

    @Test func canStepBackWhileTheEarlierPeriodStartsInsideTheKeptDays() {
        let today = "2026-10-15"
        func can(_ kind: StatsPeriodKind, _ back: Int, _ t: String = today) -> Bool {
            PlayPeriods.canStepBack(PeriodSelection(kind: kind, back: back), today: t)
        }
        #expect(can(.week, 0))
        #expect(can(.month, 0))
        #expect(range(.week, 56, today, mon).from == "2025-09-15")
        #expect(can(.week, 55))
        #expect(!can(.week, 56))
        #expect(can(.month, 11))
        #expect(!can(.month, 12))
    }

    @Test func previousYearOnlyWhenItBeganWithinTheKeptDays() {
        func can(_ t: String) -> Bool { PlayPeriods.canStepBack(PeriodSelection(kind: .year, back: 0), today: t) }
        #expect(!can("2026-10-15"))
        #expect(can("2027-01-10"))
        #expect(can("2027-02-05"))
        #expect(!can("2027-02-06"))
    }

    @Test func nothingBeforeAllTime() {
        #expect(!PlayPeriods.canStepBack(PeriodSelection(kind: .all, back: 0), today: "2026-10-15"))
    }

    // MARK: - addDays, localDayString, isoFirstDay

    @Test func addDaysCrossesMonthYearAndLeapDayEdges() {
        #expect(PlayPeriods.addDays("2026-10-15", -15) == "2026-09-30")
        #expect(PlayPeriods.addDays("2026-01-01", -1) == "2025-12-31")
        #expect(PlayPeriods.addDays("2028-03-01", -1) == "2028-02-29")
        #expect(PlayPeriods.addDays("2026-12-31", 1) == "2027-01-01")
    }

    private func calendar(_ zone: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone)!
        return calendar
    }

    @Test func localDayStringIsTheDateOnTheCalendarsClock() {
        // 2026-10-15 23:30 in New York is already the 16th in UTC, and 2026-10-15 00:30 in Auckland is the 14th in UTC.
        let ny = calendar("America/New_York")
        let late = ny.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 23, minute: 30))!
        #expect(PlayPeriods.localDayString(late, calendar: ny) == "2026-10-15")
        #expect(PlayPeriods.localDayString(late, calendar: calendar("UTC")) == "2026-10-16")
        let auckland = calendar("Pacific/Auckland")
        let early = auckland.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 0, minute: 30))!
        #expect(PlayPeriods.localDayString(early, calendar: auckland) == "2026-10-15")
        #expect(PlayPeriods.localDayString(early, calendar: calendar("UTC")) == "2026-10-14")
        let jan = calendar("UTC").date(from: DateComponents(year: 2027, month: 1, day: 1, hour: 0, minute: 1))!
        #expect(PlayPeriods.localDayString(jan, calendar: calendar("UTC")) == "2027-01-01")
        #expect(PlayPeriods.localDayString(calendar("UTC").date(from: DateComponents(year: 2026, month: 3, day: 5))!, calendar: calendar("UTC")) == "2026-03-05")
    }

    @Test func nonGregorianCalendarsStillSendGregorianDates() {
        let utc = TimeZone(identifier: "UTC")!
        let moment = calendar("UTC").date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 12))!
        for id in [Calendar.Identifier.buddhist, .japanese, .islamicUmmAlQura, .hebrew] {
            var other = Calendar(identifier: id)
            other.timeZone = utc
            other.firstWeekday = 5 // Thursday: the user's own choice stays theirs
            #expect(PlayPeriods.localDayString(moment, calendar: other) == "2026-10-15")
            #expect(PlayPeriods.isoFirstDay(fromAppleFirstWeekday: other.firstWeekday) == 4)
        }
        // The time zone still decides which day it is.
        var buddhist = Calendar(identifier: .buddhist)
        buddhist.timeZone = TimeZone(identifier: "Pacific/Auckland")!
        let lateUtc = calendar("UTC").date(from: DateComponents(year: 2026, month: 10, day: 14, hour: 20))!
        #expect(PlayPeriods.localDayString(lateUtc, calendar: buddhist) == "2026-10-15")
    }

    @Test func isoFirstDayMapsAppleWeekdaysToTheWebs() {
        #expect(PlayPeriods.isoFirstDay(fromAppleFirstWeekday: 1) == 7) // Sunday
        #expect(PlayPeriods.isoFirstDay(fromAppleFirstWeekday: 2) == 1) // Monday
        #expect(PlayPeriods.isoFirstDay(fromAppleFirstWeekday: 7) == 6) // Saturday
        #expect(PlayPeriods.isoFirstDay(fromAppleFirstWeekday: 0) == 1)
        #expect(PlayPeriods.isoFirstDay(fromAppleFirstWeekday: 8) == 1)
    }

    // MARK: - what the page asks the server for

    private func dayCount(_ range: DayRange) -> Int {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        func date(_ day: String) -> Date {
            let p = day.split(separator: "-").map { Int($0)! }
            return utc.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))!
        }
        return utc.dateComponents([.day], from: date(range.from), to: date(range.to)).day! + 1
    }

    @Test func retentionNumbersMatchTheServer() {
        #expect(PlayPeriods.retentionDays == 400)
        #expect(PlayPeriods.maxRangeDays == 400)
    }

    @Test func everyReachablePeriodPassesTheServersRangeCheck() {
        // GET /v1/plays/summary: from <= to, at most 400 days inclusive, `to` no later than tomorrow.
        var refused: [String] = []
        for i in stride(from: 0, to: 1100, by: 7) {
            let today = PlayPeriods.addDays("2024-01-01", i)
            for kind in StatsPeriodKind.allCases {
                for first in (kind == .week ? [mon, sun, sat] : [mon]) {
                    var back = 0
                    while true {
                        let selection = PeriodSelection(kind: kind, back: back)
                        let rg = PlayPeriods.selectionRange(selection, today: today, firstDay: first)
                        let days = dayCount(rg)
                        if !(rg.from <= rg.to && days >= 1 && days <= 400 && rg.to <= PlayPeriods.addDays(today, 1)) {
                            refused.append("\(kind) \(back) on \(today)")
                        }
                        if !PlayPeriods.canStepBack(selection, today: today, firstDay: first) { break }
                        back += 1
                    }
                }
            }
        }
        #expect(refused.isEmpty)
    }
}
