import Foundation

/// Orchestrates the single end-to-end flow — stage, transcode, tag, move
/// into Spotify's folder, index — by calling the four protocol-backed
/// services in order. Kept as the only place that knows the whole
/// sequence, so each service can be tested (and faked) in isolation.
final class ReleaseCoordinator {
    private let importer: FileImporter
    private let transcoder: Transcoder
    private let m4aTagWriter: TagWriter
    private let id3TagWriter: TagWriter
    private let folder: SpotifyFolderAccess
    private let library: LibraryStore
    private let layout: ReleaseLayout

    init(
        importer: FileImporter,
        transcoder: Transcoder,
        m4aTagWriter: TagWriter,
        id3TagWriter: TagWriter,
        folder: SpotifyFolderAccess,
        library: LibraryStore,
        layout: ReleaseLayout = ReleaseLayout()
    ) {
        self.importer = importer
        self.transcoder = transcoder
        self.m4aTagWriter = m4aTagWriter
        self.id3TagWriter = id3TagWriter
        self.folder = folder
        self.library = library
        self.layout = layout
    }

    /// Imports one file end to end: stage the picked URL, convert it if
    /// needed, write the given tags and cover, move the result into
    /// Spotify's folder under the flat `ReleaseLayout` name, and record a
    /// single-track `Release`. Any failure after staging removes the tmp
    /// files it created and never leaves a half-written file in the
    /// Spotify folder — the tagged file is written to a tmp location first,
    /// then moved into place with a single atomic move.
    func importSingle(file url: URL, tags: TagSet, cover: Data?) async throws -> Release {
        let staged = try await importer.stage([url])
        guard let stagedFile = staged.first else {
            throw LocallyError.importFailed("No file to import.")
        }

        defer { cleanupStagingDirectory(for: stagedFile) }

        let prepared = try await transcoder.prepare(stagedFile)
        let writer = prepared.ext == "mp3" ? id3TagWriter : m4aTagWriter
        try await writer.write(tags, cover: cover, to: prepared.url)

        let fileName = layout.fileName(
            artist: tags.artist,
            album: tags.album,
            trackNumber: tags.trackNumber,
            title: tags.title,
            ext: prepared.ext
        )

        let destinationURL: URL
        do {
            destinationURL = try folder.withAccess { folderURL -> URL in
                // Never overwrite: a user's unrelated song may share the name.
                let dest = Self.uniqueDestination(in: folderURL, fileName: fileName)
                try FileManager.default.moveItem(at: prepared.url, to: dest)
                return dest
            }
        } catch let error as LocallyError {
            throw error
        } catch {
            throw LocallyError.importFailed(error.localizedDescription)
        }

        let track = Track(
            title: tags.title,
            trackNumber: tags.trackNumber,
            filePath: destinationURL.path,
            originalName: stagedFile.originalName
        )

        let release = Release(
            kind: .single,
            title: tags.title,
            artist: tags.artist,
            year: tags.year,
            genre: tags.genre,
            coverPath: nil,
            folderPath: destinationURL.deletingLastPathComponent().path,
            tracks: [track]
        )

        do {
            try library.upsert(release)
        } catch {
            throw LocallyError.libraryFailed(error.localizedDescription)
        }

        return release
    }

    /// `name.ext`, or `name (2).ext`, `name (3).ext`, ... if taken; mirrors the
    /// Mac app's `uniqueDir` so two releases can never share (and clobber) a file.
    static func uniqueDestination(in folder: URL, fileName: String) -> URL {
        let fm = FileManager.default
        let first = folder.appendingPathComponent(fileName)
        if !fm.fileExists(atPath: first.path) { return first }
        let base = (fileName as NSString).deletingPathExtension
        let ext = (fileName as NSString).pathExtension
        for n in 2..<1000 {
            let candidate = folder.appendingPathComponent("\(base) (\(n)).\(ext)")
            if !fm.fileExists(atPath: candidate.path) { return candidate }
        }
        return folder.appendingPathComponent("\(base) (\(UUID().uuidString)).\(ext)")
    }

    private func cleanupStagingDirectory(for file: StagedFile) {
        let dir = file.url.deletingLastPathComponent()
        try? FileManager.default.removeItem(at: dir)
    }
}
