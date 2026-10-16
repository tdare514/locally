import Foundation
import Testing
@testable import Locally

/// Ports `apps/web/tests/unit/stats-copy.test.ts` for the functions the phone has.
struct StatsCopyTests {
    private let today = "2026-10-15"

    private func sel(_ kind: StatsPeriodKind, _ back: Int) -> PeriodSelection { PeriodSelection(kind: kind, back: back) }

    @Test func periodLabelNamesEachPeriodAndStepBack() {
        #expect(Copy.Stats.periodLabel(sel(.today, 0)) == "Today")
        #expect(Copy.Stats.periodLabel(sel(.today, 1)) == "Yesterday")
        #expect(Copy.Stats.periodLabel(sel(.today, 3)) == "3 days ago")
        #expect(Copy.Stats.periodLabel(sel(.week, 0)) == "This week")
        #expect(Copy.Stats.periodLabel(sel(.week, 1)) == "Last week")
        #expect(Copy.Stats.periodLabel(sel(.week, 2)) == "2 weeks ago")
        #expect(Copy.Stats.periodLabel(sel(.month, 1)) == "Last month")
        #expect(Copy.Stats.periodLabel(sel(.month, 4)) == "4 months ago")
        #expect(Copy.Stats.periodLabel(sel(.year, 0)) == "This year")
        #expect(Copy.Stats.periodLabel(sel(.year, 1)) == "Last year")
        #expect(Copy.Stats.periodLabel(sel(.all, 0)) == "All time")
    }

    @Test func periodWhenReadsInsideASentence() {
        #expect(Copy.Stats.periodWhen(sel(.week, 0)) == "this week")
        #expect(Copy.Stats.periodWhen(sel(.month, 2)) == "2 months ago")
        #expect(Copy.Stats.periodWhen(sel(.all, 0)) == "so far")
    }

    @Test func periodOptionsAreTheFiveLabels() {
        #expect(Copy.Stats.periodOptions.map(\.label) == ["Today", "This week", "This month", "This year", "All time"])
        #expect(Copy.Stats.periodOptions.map(\.kind) == StatsPeriodKind.allCases)
    }

    private func detail(_ kind: StatsPeriodKind, _ back: Int) -> String {
        let selection = sel(kind, back)
        return Copy.Stats.periodDetail(selection, range: PlayPeriods.selectionRange(selection, today: today, firstDay: 1), today: today)
    }

    @Test func periodDetailShowsTheDatesAPeriodCovers() {
        #expect(detail(.today, 0) == "Thu 15 Oct")
        #expect(detail(.week, 0) == "12 to 15 Oct")
        #expect(detail(.week, 1) == "5 to 11 Oct")
        #expect(detail(.week, 2) == "28 Sep to 4 Oct")
        #expect(detail(.month, 1) == "September 2026")
        #expect(detail(.year, 0) == "2026")
        #expect(detail(.all, 0) == "Everything counted")
    }

    @Test func digestSentenceIsTheApprovedSentence() {
        #expect(Copy.Stats.digestSentence(sel(.week, 0), total: 121, topTrack: "Night Bus to Nowhere")
            == "You played your tracks 121 times this week, mostly Night Bus to Nowhere.")
    }

    @Test func digestSentenceSingularPastPeriodsThousandsAndAllTime() {
        #expect(Copy.Stats.digestSentence(sel(.today, 0), total: 1, topTrack: "Tide") == "You played your tracks 1 time today, mostly Tide.")
        #expect(Copy.Stats.digestSentence(sel(.week, 1), total: 1204, topTrack: "Tide")
            == "You played your tracks 1,204 times last week, mostly Tide.")
        #expect(Copy.Stats.digestSentence(sel(.all, 0), total: 9, topTrack: "Tide") == "You have played your tracks 9 times so far, mostly Tide.")
    }

    @Test func digestSentenceFallsBackToTheEmptyLineWithNoPlays() {
        #expect(Copy.Stats.digestSentence(sel(.week, 0), total: 0, topTrack: nil) == "No plays yet this week.")
        #expect(Copy.Stats.digestSentence(sel(.all, 0), total: 0, topTrack: nil) == "No plays counted yet.")
    }

    @Test func emptyPeriodLineSaysYetOnlyForTheCurrentPeriod() {
        #expect(Copy.Stats.emptyPeriodLine(sel(.today, 0)) == "No plays yet today.")
        #expect(Copy.Stats.emptyPeriodLine(sel(.week, 0)) == "No plays yet this week.")
        #expect(Copy.Stats.emptyPeriodLine(sel(.month, 1)) == "No plays last month.")
    }

    @Test func lastPlayedLabelIsRelativeForAWeekAndADateAfter() {
        #expect(Copy.Stats.lastPlayedLabel(nil, today: today) == "–")
        #expect(Copy.Stats.lastPlayedLabel("2026-10-15", today: today) == "Today")
        #expect(Copy.Stats.lastPlayedLabel("2026-10-14", today: today) == "Yesterday")
        #expect(Copy.Stats.lastPlayedLabel("2026-10-10", today: today) == "5 days ago")
        #expect(Copy.Stats.lastPlayedLabel("2026-10-08", today: today) == "8 Oct")
        #expect(Copy.Stats.lastPlayedLabel("2025-12-30", today: today) == "30 Dec 2025")
    }

    @Test func formatsCounts() {
        #expect(Copy.Stats.formatCount(1204) == "1,204")
        #expect(Copy.Stats.playsCount(1) == "1 play")
        #expect(Copy.Stats.playsCount(1204) == "1,204 plays")
        #expect(Copy.Stats.shortDay("2026-03-05", today: today) == "5 Mar")
    }

    @Test func iPhoneStringsAreVerbatim() {
        #expect(Copy.Stats.title == "Stats")
        #expect(Copy.Stats.tabLabel == "Stats")
        #expect(Copy.Stats.coverage == "Collected across all your devices.")
        #expect(Copy.Stats.signedOutTitle == "Your plays live on your Mac")
        #expect(Copy.Stats.signedOutAction == "Sign in")
        #expect(Copy.Stats.failed == "Couldn't load your plays. Pull down to try again.")
        #expect(Copy.Stats.busy == "Couldn't load your plays just now. Try again in a few minutes.")
    }
}
