import Foundation

/// Whether the one-time offer to look through the Spotify folder has been made (#332). It is made once, after
/// onboarding; Settings has the same page whenever the user wants it. The folder is never scanned on launch.
enum AdoptOffer {
    static let offeredKey = "locally.adopt.offered.v1"

    static func shouldOffer(defaults: UserDefaults = .standard) -> Bool {
        !defaults.bool(forKey: offeredKey)
    }

    static func markOffered(defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: offeredKey)
    }
}

/// Drives the review page: scan, tick, add. One scan per `start()`; it never runs by itself.
@MainActor
@Observable
final class AdoptReviewModel {
    enum Phase: Equatable {
        case idle
        case scanning(done: Int, total: Int)
        case ready(AdoptReview)
        case adding
        case done(AdoptOutcome)
        case failed(String)
    }

    private let adopter: SpotifyAdopter

    private(set) var phase: Phase = .idle
    /// Keys of the groups that will be added. Everything starts ticked.
    private(set) var selected: Set<String> = []

    init(adopter: SpotifyAdopter) {
        self.adopter = adopter
    }

    var review: AdoptReview? {
        if case .ready(let review) = phase { return review }
        return nil
    }

    var selectedCount: Int { review?.items.filter { selected.contains($0.id) }.count ?? 0 }
    var canAdd: Bool { selectedCount > 0 }

    func isSelected(_ key: String) -> Bool { selected.contains(key) }

    func toggle(_ key: String) {
        guard case .ready = phase else { return }
        if selected.contains(key) { selected.remove(key) } else { selected.insert(key) }
    }

    func start() async {
        switch phase {
        case .scanning, .adding: return
        default: break
        }
        phase = .scanning(done: 0, total: 0)
        do {
            let review = try await adopter.scan { [weak self] done, total in
                self?.phase = .scanning(done: done, total: total)
            }
            selected = Set(review.items.map(\.id))
            phase = .ready(review)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func add() async {
        guard case .ready(let review) = phase, canAdd else { return }
        let keys = selected
        phase = .adding
        do {
            let outcome = try await adopter.adopt(review, keys: keys)
            phase = .done(outcome)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func cover(for item: AdoptReview.Item) async -> Data? {
        await adopter.previewCover(for: item)
    }
}
