import UIKit
import UniformTypeIdentifiers

/// The "Send to Locally" share extension: copies every shared audio file
/// into the App Group's shared Inbox folder (where the main app's
/// `AppGroupInboxStore` will find them) and shows a one-line result. A
/// share extension cannot open its containing app, so this never tries to
/// — the result tells the user to switch to Locally themselves.
final class ShareViewController: UIViewController {
    private let activityIndicator = UIActivityIndicatorView(style: .medium)
    private let statusLabel = UILabel()
    private let doneButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        configureUI()
        Task { await handleSharedItems() }
    }

    private func configureUI() {
        view.backgroundColor = .systemBackground

        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.text = "Saving to Locally…"

        doneButton.setTitle("Done", for: .normal)
        doneButton.isHidden = true
        doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [activityIndicator, statusLabel, doneButton])
        stack.axis = .vertical
        stack.spacing = 16
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32)
        ])

        activityIndicator.startAnimating()
    }

    private func handleSharedItems() async {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }

        guard !providers.isEmpty else {
            showResult(message: "Couldn't find any audio to save.")
            return
        }

        var savedCount = 0
        var lastError: String?
        for provider in providers {
            do {
                try await save(provider)
                savedCount += 1
            } catch {
                lastError = error.localizedDescription
            }
        }

        if savedCount > 0 {
            showResult(message: "Saved to Locally. Open Locally to tag and send.")
        } else {
            showResult(message: lastError ?? "Couldn't save that file.")
        }
    }

    private func save(_ provider: NSItemProvider) async throws {
        let audioType = UTType.audio.identifier
        guard provider.hasItemConformingToTypeIdentifier(audioType) else {
            throw ShareError.notAudio
        }

        guard let inboxDirectory = Self.inboxDirectory() else {
            throw ShareError.noAppGroup
        }
        try FileManager.default.createDirectory(at: inboxDirectory, withIntermediateDirectories: true)

        // `loadFileRepresentation` hands us a temporary URL that the system
        // deletes as soon as this completion handler returns. Copying after
        // resuming a continuation is therefore too late ("file doesn't
        // exist"), so the copy into the Inbox happens inside the handler
        // and only the destination URL leaves it.
        _ = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
            provider.loadFileRepresentation(forTypeIdentifier: audioType) { url, error in
                guard let url else {
                    continuation.resume(throwing: error ?? ShareError.notAudio)
                    return
                }
                let accessed = url.startAccessingSecurityScopedResource()
                defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                let destinationName = InboxFileNaming.fileName(id: UUID(), originalName: url.lastPathComponent)
                let destination = inboxDirectory.appendingPathComponent(destinationName)
                do {
                    try FileManager.default.copyItem(at: url, to: destination)
                    continuation.resume(returning: destination)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func inboxDirectory() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: AppGroup.identifier)?
            .appendingPathComponent("Inbox", isDirectory: true)
    }

    private func showResult(message: String) {
        activityIndicator.stopAnimating()
        activityIndicator.isHidden = true
        statusLabel.text = message
        doneButton.isHidden = false
    }

    @objc private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }

    private enum ShareError: LocalizedError {
        case notAudio
        case noAppGroup

        var errorDescription: String? {
            switch self {
            case .notAudio: return "That file isn't audio."
            case .noAppGroup: return "Couldn't reach Locally's shared storage."
            }
        }
    }
}
