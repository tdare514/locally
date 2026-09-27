import Foundation

/// Orchestrates every end-to-end release flow — import (single or album),
/// edit in place, and delete — by calling the protocol-backed services in
/// order. Kept as the only place that knows any of these sequences, so each
/// service can be tested (and faked) in isolation.
final class ReleaseCoordinator {
    private let importer: FileImporter
    private let transcoder: Transcoder
    private let m4aTagWriter: TagWriter
    private let id3TagWriter: TagWriter
    private let folder: SpotifyFolderAccess
    private let library: LibraryStore
    private let coverStore: CoverStore
    private let layout: ReleaseLayout

    init(
        importer: FileImporter,
        transcoder: Transcoder,
        m4aTagWriter: TagWriter,
        id3TagWriter: TagWriter,
        folder: SpotifyFolderAccess,
        library: LibraryStore,
        coverStore: CoverStore,
        layout: ReleaseLayout = ReleaseLayout()
    ) {
        self.importer = importer
        self.transcoder = transcoder
        self.m4aTagWriter = m4aTagWriter
        self.id3TagWriter = id3TagWriter
        self.folder = folder
        self.library = library
        self.coverStore = coverStore
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
        let releaseId = UUID()
        let staged = try await importer.stage([url])
        guard let stagedFile = staged.first else {
            throw LocallyError.importFailed("No file to import.")
        }

        defer { cleanupStagingDirectory(for: stagedFile) }

        let prepared = try await transcoder.prepare(stagedFile)
        let writer = writer(for: prepared.ext)
        try await writer.write(tags, cover: cover, to: prepared.url)

        let fileName = layout.fileName(
            artist: tags.artist,
            album: tags.album,
            trackNumber: tags.trackNumber,
            title: tags.title,
            ext: prepared.ext
        )

        let destinationURL = try moveIntoFolder(from: prepared.url, fileName: fileName)

        let coverPath = cover.flatMap { try? coverStore.save($0, for: releaseId) }

        let track = Track(
            title: tags.title,
            trackNumber: tags.trackNumber,
            filePath: destinationURL.path,
            originalName: stagedFile.originalName
        )

        let release = Release(
            id: releaseId,
            kind: .single,
            title: tags.title,
            artist: tags.artist,
            year: tags.year,
            genre: tags.genre,
            coverPath: coverPath,
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

    /// Imports every file in `files` as one album: each file becomes a
    /// track numbered by its position (1-based), sharing `album`'s
    /// title/artist/year/genre/cover. Tracks are staged, transcoded,
    /// tagged, and moved into Spotify's folder one at a time, reporting
    /// `progress` (tracks done, total) as each one lands. If any track
    /// fails, every file this call already moved into the Spotify folder is
    /// removed and the library is left untouched, then the error is
    /// rethrown — an album import either fully lands or leaves no trace.
    func importAlbum(
        files: [URL],
        album: AlbumDraft,
        cover: Data?,
        progress: ((Int, Int) -> Void)? = nil
    ) async throws -> Release {
        guard !files.isEmpty else {
            throw LocallyError.importFailed("No files to import.")
        }
        guard files.count == album.tracks.count else {
            throw LocallyError.importFailed("Every file needs a track title.")
        }

        let releaseId = UUID()
        let total = files.count
        var movedURLs: [URL] = []
        var tracks: [Track] = []

        do {
            for (index, fileURL) in files.enumerated() {
                let staged = try await importer.stage([fileURL])
                guard let stagedFile = staged.first else {
                    throw LocallyError.importFailed("No file to import.")
                }
                defer { cleanupStagingDirectory(for: stagedFile) }

                let prepared = try await transcoder.prepare(stagedFile)
                let trackNumber = index + 1
                let tags = TagSet(
                    title: album.tracks[index].title,
                    artist: album.artist,
                    album: album.title,
                    trackNumber: trackNumber,
                    totalTracks: total,
                    year: album.year,
                    genre: album.genre
                )

                let writer = writer(for: prepared.ext)
                try await writer.write(tags, cover: cover, to: prepared.url)

                let fileName = layout.fileName(
                    artist: album.artist,
                    album: album.title,
                    trackNumber: trackNumber,
                    title: album.tracks[index].title,
                    ext: prepared.ext
                )
                let destinationURL = try moveIntoFolder(from: prepared.url, fileName: fileName)
                movedURLs.append(destinationURL)

                tracks.append(Track(
                    id: album.tracks[index].id,
                    title: album.tracks[index].title,
                    trackNumber: trackNumber,
                    filePath: destinationURL.path,
                    originalName: stagedFile.originalName
                ))

                progress?(trackNumber, total)
            }
        } catch {
            removeMovedFiles(movedURLs)
            throw error
        }

        let coverPath = cover.flatMap { try? coverStore.save($0, for: releaseId) }

        let release = Release(
            id: releaseId,
            kind: .album,
            title: album.title,
            artist: album.artist,
            year: album.year,
            genre: album.genre,
            coverPath: coverPath,
            folderPath: movedURLs.first?.deletingLastPathComponent().path ?? "",
            tracks: tracks
        )

        do {
            try library.upsert(release)
        } catch {
            throw LocallyError.libraryFailed(error.localizedDescription)
        }

        return release
    }

    /// Rewrites every track's tags in place (title/artist/album/track
    /// number/year/genre/cover) per `changes`, keeping each file's name and
    /// location unchanged, then updates the store. Track numbers follow
    /// `changes.trackOrder` when given, otherwise the release's current
    /// order. Throws `LocallyError.fileMissing` if a track's recorded file
    /// is no longer there.
    func updateRelease(_ id: UUID, changes: ReleaseChanges) async throws -> Release {
        let releases = try library.all()
        guard let existing = releases.first(where: { $0.id == id }) else {
            throw LocallyError.libraryFailed("Couldn't find that release.")
        }

        var tracks = orderedTracks(existing.tracks, order: changes.trackOrder)
        for index in tracks.indices {
            tracks[index].trackNumber = index + 1
            if let newTitle = changes.trackTitles[tracks[index].id] {
                tracks[index].title = newTitle
            }
        }

        let newTitle = changes.title ?? existing.title
        let newArtist = changes.artist ?? existing.artist
        let newYear = changes.year.map { $0.isEmpty ? nil : $0 } ?? existing.year
        let newGenre = changes.genre.map { $0.isEmpty ? nil : $0 } ?? existing.genre

        var newCoverPath = existing.coverPath
        if let coverData = changes.cover {
            newCoverPath = try? coverStore.save(coverData, for: id)
        }
        // Re-embed the existing cover unless it just changed, so an edit
        // that doesn't touch the cover doesn't strip artwork the tag
        // writers only re-add when handed the bytes again.
        let coverForWrite: Data? = changes.cover ?? (existing.coverPath != nil ? coverStore.load(id) : nil)

        let totalTracks = tracks.count
        let finalTracks = tracks

        try await folder.withAccess { folderURL in
            for track in finalTracks {
                let fileURL = Self.resolvedFileURL(for: track, in: folderURL)
                guard self.layout.isInside(folder: folderURL, path: fileURL.path) else {
                    throw LocallyError.pathOutsideFolder
                }
                guard FileManager.default.fileExists(atPath: fileURL.path) else {
                    throw LocallyError.fileMissing(track.title)
                }
                let tags = TagSet(
                    title: track.title,
                    artist: newArtist,
                    album: newTitle,
                    trackNumber: track.trackNumber,
                    totalTracks: totalTracks,
                    year: newYear,
                    genre: newGenre
                )
                let writer = self.writer(for: fileURL.pathExtension.lowercased())
                try await writer.write(tags, cover: coverForWrite, to: fileURL)
            }
        }

        let updated = Release(
            id: existing.id,
            kind: existing.kind,
            title: newTitle,
            artist: newArtist,
            year: newYear,
            genre: newGenre,
            coverPath: newCoverPath,
            folderPath: existing.folderPath,
            tracks: tracks,
            createdAt: existing.createdAt,
            updatedAt: Date()
        )

        do {
            try library.upsert(updated)
        } catch {
            throw LocallyError.libraryFailed(error.localizedDescription)
        }

        return updated
    }

    /// Removes every track file from the Spotify folder (a file already
    /// missing is not an error) and deletes the release from the store.
    /// Refuses — and deletes nothing — if any track's recorded path
    /// resolves to somewhere outside the connected folder.
    func deleteRelease(_ id: UUID) async throws {
        let releases = try library.all()
        guard let existing = releases.first(where: { $0.id == id }) else {
            try library.delete(id: id)
            return
        }

        try folder.withAccess { folderURL -> Void in
            let urls = existing.tracks.map { Self.resolvedFileURL(for: $0, in: folderURL) }
            for url in urls {
                guard self.layout.isInside(folder: folderURL, path: url.path) else {
                    throw LocallyError.pathOutsideFolder
                }
            }
            for url in urls where FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
        }

        try? coverStore.delete(id)

        do {
            try library.delete(id: id)
        } catch {
            throw LocallyError.libraryFailed(error.localizedDescription)
        }
    }

    /// The track's file as it is reachable now. The stored path is absolute,
    /// but Spotify's container moves when Spotify is reinstalled, so when
    /// that path no longer exists the file is looked up by name inside the
    /// currently connected folder (the app never renames files, so the name
    /// is stable). The caller still runs the inside-folder guard on the result.
    static func resolvedFileURL(for track: Track, in folderURL: URL) -> URL {
        if FileManager.default.fileExists(atPath: track.filePath) {
            return URL(fileURLWithPath: track.filePath)
        }
        let name = (track.filePath as NSString).lastPathComponent
        return folderURL.appendingPathComponent(name)
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

    // MARK: - Private helpers

    private func writer(for ext: String) -> TagWriter {
        ext == "mp3" ? id3TagWriter : m4aTagWriter
    }

    private func moveIntoFolder(from sourceURL: URL, fileName: String) throws -> URL {
        do {
            return try folder.withAccess { folderURL -> URL in
                // Never overwrite: a user's unrelated song may share the name.
                let dest = Self.uniqueDestination(in: folderURL, fileName: fileName)
                try FileManager.default.moveItem(at: sourceURL, to: dest)
                return dest
            }
        } catch let error as LocallyError {
            throw error
        } catch {
            throw LocallyError.importFailed(error.localizedDescription)
        }
    }

    private func removeMovedFiles(_ urls: [URL]) {
        guard !urls.isEmpty else { return }
        try? folder.withAccess { _ in
            for url in urls {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    /// Applies `order` (full new order by track id) to `tracks`, appending
    /// any known track missing from `order` after — so a caller can't drop
    /// a track by leaving its id out. `nil` keeps the existing order.
    private func orderedTracks(_ tracks: [Track], order: [UUID]?) -> [Track] {
        guard let order else { return tracks }
        var byId = Dictionary(uniqueKeysWithValues: tracks.map { ($0.id, $0) })
        var reordered: [Track] = []
        for trackId in order {
            if let track = byId.removeValue(forKey: trackId) {
                reordered.append(track)
            }
        }
        reordered.append(contentsOf: tracks.filter { byId[$0.id] != nil })
        return reordered
    }

    private func cleanupStagingDirectory(for file: StagedFile) {
        let dir = file.url.deletingLastPathComponent()
        try? FileManager.default.removeItem(at: dir)
    }
}
