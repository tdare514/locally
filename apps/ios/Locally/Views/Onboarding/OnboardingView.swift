import SwiftUI

/// The four-step first-run flow: welcome, Premium note, the Local Files
/// guide, then the folder picker and confirmation. Copy is verbatim from
/// `docs/ios-plan.md`'s "In-app copy" section, via `Copy.Onboarding`.
struct OnboardingView: View {
    private enum Step: Int, CaseIterable {
        case welcome, premium, localFiles, folder
    }

    @Environment(\.appContainer) private var container
    @Environment(FolderStatus.self) private var folderStatus

    @State private var step: Step = .welcome
    @State private var isPresentingFolderPicker = false
    @State private var isConfirmed = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()

                content

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Spacer()

                actionButton
            }
            .padding(24)
        }
        .fileImporter(isPresented: $isPresentingFolderPicker, allowedContentTypes: [.folder]) { result in
            handleFolderPick(result)
        }
    }

    @ViewBuilder
    private var content: some View {
        if isConfirmed {
            confirmationStep
        } else {
            switch step {
            case .welcome: welcomeStep
            case .premium: premiumStep
            case .localFiles: localFilesStep
            case .folder: folderStep
            }
        }
    }

    private var welcomeStep: some View {
        VStack(spacing: 16) {
            Text(Copy.Onboarding.welcomeTitle)
                .font(.largeTitle.bold())
                .foregroundStyle(Theme.primaryText)
            Text(Copy.Onboarding.welcomeBody)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
        }
    }

    private var premiumStep: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.seal")
                .font(.largeTitle)
                .foregroundStyle(Theme.accent)
            Text(Copy.Onboarding.premium)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
        }
    }

    private var localFilesStep: some View {
        VStack(spacing: 16) {
            Text(Copy.Onboarding.localFilesTitle)
                .font(.title2.bold())
                .foregroundStyle(Theme.primaryText)
            Text(Copy.Onboarding.localFilesBody)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
        }
    }

    private var folderStep: some View {
        VStack(spacing: 16) {
            Text(Copy.Onboarding.folderAccessTitle)
                .font(.title2.bold())
                .foregroundStyle(Theme.primaryText)
            Text(Copy.Onboarding.folderAccessBody)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
        }
    }

    private var confirmationStep: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.largeTitle)
                .foregroundStyle(Theme.accent)
            Text(Copy.Onboarding.confirmationTitle)
                .font(.title2.bold())
                .foregroundStyle(Theme.primaryText)
            Text(Copy.Onboarding.confirmationBody)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
        }
    }

    @ViewBuilder
    private var actionButton: some View {
        if isConfirmed {
            Button(Copy.Onboarding.getStarted) {
                // RootView switches to the main tabs automatically once
                // `folderStatus.isConnected` flips to true; nothing to do here.
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        } else if step == .folder {
            Button(Copy.Onboarding.chooseFolder) {
                isPresentingFolderPicker = true
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        } else {
            Button(Copy.Onboarding.next) {
                if let next = Step(rawValue: step.rawValue + 1) {
                    step = next
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
    }

    private func handleFolderPick(_ result: Result<URL, Error>) {
        guard let container else { return }
        switch result {
        case .success(let url):
            do {
                try container.connectFolder(url: url)
                errorMessage = nil
                isConfirmed = true
            } catch {
                errorMessage = error.localizedDescription
            }
        case .failure(let error):
            errorMessage = error.localizedDescription
        }
    }
}
