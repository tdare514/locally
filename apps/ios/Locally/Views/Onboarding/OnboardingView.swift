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

    /// Called when the user taps "Get started" on the confirmation screen.
    let onFinished: () -> Void

    @State private var step: Step = .welcome
    @State private var isPresentingFolderPicker = false
    @State private var isConfirmed = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: Theme.Spacing.sectionGap) {
                Spacer()

                content

                if let errorMessage {
                    Text(errorMessage)
                        .font(Theme.Font.rowSubtitle)
                        .foregroundStyle(Theme.danger)
                }

                Spacer()

                actionButton
            }
            .padding(Theme.Spacing.pagePadding)
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
            Image("ListenerSolid")
                .resizable()
                .scaledToFit()
                .frame(height: 220)
                .accessibilityHidden(true)
                .padding(.bottom, 8)
            Text(Copy.Onboarding.welcomeTitle)
                .font(Theme.Font.pageTitle)
                .foregroundStyle(Theme.primaryText)
            Text(Copy.Onboarding.welcomeBody)
                .font(Theme.Font.body)
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
                .font(Theme.Font.body)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
        }
    }

    private var localFilesStep: some View {
        VStack(spacing: 16) {
            Text(Copy.Onboarding.localFilesTitle)
                .font(Theme.Font.pageTitle)
                .foregroundStyle(Theme.primaryText)
            Text(Copy.Onboarding.localFilesBody)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
        }
    }

    private var folderStep: some View {
        VStack(spacing: 16) {
            Text(Copy.Onboarding.folderAccessTitle)
                .font(Theme.Font.pageTitle)
                .foregroundStyle(Theme.primaryText)
            Text(Copy.Onboarding.folderAccessBody)
                .font(Theme.Font.body)
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
                .font(Theme.Font.pageTitle)
                .foregroundStyle(Theme.primaryText)
            Text(Copy.Onboarding.confirmationBody)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
        }
    }

    @ViewBuilder
    private var actionButton: some View {
        if isConfirmed {
            Button(Copy.Onboarding.getStarted, action: onFinished)
                .buttonStyle(PrimaryPillButtonStyle())
        } else if step == .folder {
            Button(Copy.Onboarding.chooseFolder) {
                isPresentingFolderPicker = true
            }
            .buttonStyle(PrimaryPillButtonStyle())
        } else {
            Button(Copy.Onboarding.next) {
                if let next = Step(rawValue: step.rawValue + 1) {
                    step = next
                }
            }
            .buttonStyle(PrimaryPillButtonStyle())
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
