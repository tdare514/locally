import Foundation

/// The Stats page's periods, shortest first (port of `apps/web/src/lib/play-periods.ts`, #145).
enum StatsPeriodKind: String, CaseIterable {
    case today, week, month, year, all
}

/// A period and how many steps back from the current one (0 is today, this week, ...).
struct PeriodSelection: Equatable {
    var kind: StatsPeriodKind
    var back: Int
}

/// A run of local calendar days, written `YYYY-MM-DD`, both ends inclusive.
struct DayRange: Equatable {
    var from: String
    var to: String
}

/// Pure day arithmetic behind the Stats periods. Days are `YYYY-MM-DD` strings and are moved by
/// whole-day numbers (days since 1970-01-01), exactly as the Mac does, so no time zone or daylight
/// saving can shift a result. Only `localDayString` reads a calendar, to say what "today" is.
enum PlayPeriods {
    /// How many days the server keeps day buckets, and so how far back a request may start.
    static let retentionDays = 400
    /// The most days one summary request may span.
    static let maxRangeDays = 400
    /// Weekday numbers as the web has them: 1 is Monday, 7 is Sunday.
    static let monday = 1

    // MARK: Civil date <-> day number

    private static func floorDiv(_ a: Int, _ b: Int) -> Int {
        let q = a / b
        return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q
    }

    /// Days since 1970-01-01 of a proleptic Gregorian date (`month` 1...12).
    private static func daysFromCivil(_ year: Int, _ month: Int, _ day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = floorDiv(y, 400)
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    private static func civilFromDays(_ days: Int) -> (year: Int, month: Int, day: Int) {
        let z = days + 719_468
        let era = floorDiv(z, 146_097)
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let day = doy - (153 * mp + 2) / 5 + 1
        let month = mp < 10 ? mp + 3 : mp - 9
        let year = yoe + era * 400 + (month <= 2 ? 1 : 0)
        return (year, month, day)
    }

    /// Like JavaScript's `Date.UTC(year, month0, day)`: a month or day out of range rolls over.
    private static func utc(_ year: Int, _ month0: Int, _ day: Int) -> Int {
        let y = year + floorDiv(month0, 12)
        let m0 = month0 - floorDiv(month0, 12) * 12
        return daysFromCivil(y, m0 + 1, 1) + day - 1
    }

    private static func string(fromDayNumber n: Int) -> String {
        let c = civilFromDays(n)
        return String(format: "%04d-%02d-%02d", c.year, c.month, c.day)
    }

    private static func parts(_ day: String) -> (year: Int, month: Int, date: Int) {
        let p = day.split(separator: "-").map { Int($0) ?? 0 }
        guard p.count == 3 else { return (1970, 1, 1) }
        return (p[0], p[1], p[2])
    }

    private static func dayNumber(_ day: String) -> Int {
        let p = parts(day)
        return daysFromCivil(p.year, p.month, p.date)
    }

    // MARK: Public API

    /// `day` (`YYYY-MM-DD`) moved by `n` days, which may be negative.
    static func addDays(_ day: String, _ n: Int) -> String {
        string(fromDayNumber: dayNumber(day) + n)
    }

    /// 0 is Sunday ... 6 is Saturday, for a `YYYY-MM-DD` day.
    static func weekday(of day: String) -> Int {
        let r = (dayNumber(day) + 4) % 7 // 1970-01-01 was a Thursday
        return r < 0 ? r + 7 : r
    }

    /// The date on the calendar's clock as `YYYY-MM-DD`, in the calendar's time zone.
    static func localDayString(_ date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// Apple's `Calendar.firstWeekday` (1 Sunday ... 7 Saturday) as the web's number (1 Monday ... 7 Sunday).
    static func isoFirstDay(fromAppleFirstWeekday weekday: Int) -> Int {
        guard (1...7).contains(weekday) else { return monday }
        return weekday == 1 ? 7 : weekday - 1
    }

    /// Port of `periodRangeOfDay("week", ...).from`: the first day of `day`'s week.
    private static func weekStart(of day: String, firstDay: Int) -> String {
        let first = (1...7).contains(firstDay) ? firstDay : monday
        let daysIntoWeek = (weekday(of: day) - (first % 7) + 7) % 7
        return addDays(day, -daysIntoWeek)
    }

    /// The days a period covers, as the summary request's `from` and `to`. `today` is the local date.
    /// Back 0 ends today; a period stepped back to is the whole of that day, week, month or year.
    /// All time asks for the longest range the server allows.
    static func selectionRange(_ selection: PeriodSelection, today: String, firstDay: Int = monday) -> DayRange {
        let back = max(0, selection.back)
        let t = parts(today)
        switch selection.kind {
        case .today:
            let day = addDays(today, -back)
            return DayRange(from: day, to: day)
        case .week:
            let from = addDays(weekStart(of: today, firstDay: firstDay), -7 * back)
            return DayRange(from: from, to: back == 0 ? today : addDays(from, 6))
        case .month:
            let from = string(fromDayNumber: utc(t.year, t.month - 1 - back, 1))
            return DayRange(from: from, to: back == 0 ? today : string(fromDayNumber: utc(t.year, t.month - back, 0)))
        case .year:
            let from = string(fromDayNumber: utc(t.year - back, 0, 1))
            return DayRange(from: from, to: back == 0 ? today : string(fromDayNumber: utc(t.year - back, 11, 31)))
        case .all:
            return DayRange(from: addDays(today, 1 - maxRangeDays), to: today)
        }
    }

    /// Whether the period before this one can be asked for: it must start within the days the
    /// server keeps. All time has nothing before it.
    static func canStepBack(_ selection: PeriodSelection, today: String, firstDay: Int = monday) -> Bool {
        if selection.kind == .all { return false }
        let earlier = selectionRange(PeriodSelection(kind: selection.kind, back: selection.back + 1), today: today, firstDay: firstDay)
        return earlier.from >= addDays(today, -retentionDays)
    }
}
