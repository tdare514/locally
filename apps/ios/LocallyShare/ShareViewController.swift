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
        statusLabel.text = ShareCopy.saving

        doneButton.setTitle(ShareCopy.done, for: .normal)
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
            showResult(message: ShareCopy.noAudio)
            return
        }

        var savedCount = 0
        var unsupportedCount = 0
        var lastError: String?
        for provider in providers {
            do {
                try await save(provider)
                savedCount += 1
            } catch let error as ShareError {
                if case .unsupportedFormat = error {
                    unsupportedCount += 1
                }
                lastError = error.errorDescription
            } catch {
                lastError = error.localizedDescription
            }
        }

        if savedCount > 0, unsupportedCount > 0 {
            showResult(message: ShareCopy.savedSome(savedCount, skipped: unsupportedCount))
        } else if savedCount > 0 {
            showResult(message: ShareCopy.saved)
        } else {
            showResult(message: lastError ?? ShareCopy.saveFailed)
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
                let originalName = url.lastPathComponent
                guard SupportedAudio.isSupported(fileName: originalName) else {
                    continuation.resume(throwing: ShareError.unsupportedFormat(fileExtension: url.pathExtension))
                    return
                }
                let destinationName = InboxFileNaming.fileName(id: UUID(), originalName: originalName)
                let destination = inboxDirectory.appendingPathComponent(destinationName)
                do {
                    try FileManager.default.copyItem(at: url, to: destination)
                    continuation.resume(returning: destination)
                } catch {
                    try? FileManager.default.removeItem(at: destination)
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func inboxDirectory() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: AppGroup.identifier)?
            .appendingPathComponent(InboxFileNaming.folderName, isDirectory: true)
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
        case unsupportedFormat(fileExtension: String)

        var errorDescription: String? {
            switch self {
            case .notAudio: return ShareCopy.notAudio
            case .noAppGroup: return ShareCopy.noAppGroup
            case .unsupportedFormat(let ext): return ShareCopy.unsupportedFormat(fileExtension: ext)
            }
        }
    }
}
