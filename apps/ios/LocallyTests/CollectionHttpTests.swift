import Foundation
import Testing
@testable import Locally

/// `HttpSyncApi`'s collection calls over the stubbed `URLProtocol` (in the serialized suite that owns it).
extension HttpSyncApiTests {
    private func collectionsApi() -> HttpSyncApi {
        let account = InMemorySyncAccountStore()
        account.baseURL = URL(string: "https://sync.example.test")!
        account.save(email: "toby@example.com", deviceToken: "device-token", deviceId: "device-1")
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return HttpSyncApi(account: account, session: URLSession(configuration: config))
    }

    @Test func collectionsPageDecodesTheLiteralReply() async throws {
        let valid = String(decoding: try CollectionFixtureTests.data("valid.json"), as: UTF8.self)
        let unknown = String(decoding: try CollectionFixtureTests.data("unknown-kind.json"), as: UTF8.self)
        let withVersion = { (json: String, version: Int) in
            json.replacingOccurrences(of: "\"deleted\": false", with: "\"deleted\": false, \"version\": \(version), \"serverUpdatedAt\": \"2026-10-23T20:00:01.250Z\"")
        }
        let body = "{\"collections\":[\(withVersion(valid, 7)),\(withVersion(unknown, 9))],\"nextVersion\":9,\"hasMore\":true}"
        StubURLProtocol.handler = { _ in (200, [:], Data(body.utf8)) }

        let page = try await collectionsApi().collections(sinceVersion: 5, limit: 200)

        #expect(StubURLProtocol.lastRequest?.url?.absoluteString == "https://sync.example.test/v1/collections?sinceVersion=5&limit=200")
        #expect(StubURLProtocol.lastRequest?.httpMethod == "GET")
        #expect(page.nextVersion == 9)
        #expect(page.hasMore)
        #expect(page.collections.map(\.version) == [7, 9])
        #expect(page.collections.map(\.name) == ["Late drives", "From a newer app"])
        #expect(page.collections[0].serverUpdatedAt != nil)
    }

    @Test func putSendsTheRecordAndDecodesVersionAndPruned() async throws {
        StubURLProtocol.handler = { _ in (200, [:], Data("{\"version\":12,\"pruned\":2}".utf8)) }
        let record = try JSONDecoder.syncApi.decode(SyncCollection.self, from: try CollectionFixtureTests.data("valid.json"))

        let result = try await collectionsApi().putCollection(record)

        #expect(result == SyncCollectionPutResult(version: 12, pruned: 2))
        let request = try #require(StubURLProtocol.lastRequest)
        #expect(request.httpMethod == "PUT")
        #expect(request.url?.path == "/v1/collections/9c1e2f40-6b3a-4d7e-8a51-2f0c9d4b7e13")
        let sent = try #require(try JSONSerialization.jsonObject(with: StubURLProtocol.bodyData(of: request)) as? [String: Any])
        #expect(sent["id"] as? String == "9c1e2f40-6b3a-4d7e-8a51-2f0c9d4b7e13")
        #expect(sent["syncVersion"] as? Int == 1)
        #expect(sent["version"] == nil)
        #expect((sent["items"] as? [Any])?.count == 2)
    }

    @Test func deleteDecodesTheVersion() async throws {
        StubURLProtocol.handler = { _ in (200, [:], Data("{\"version\":13}".utf8)) }
        let version = try await collectionsApi().deleteCollection("9c1e2f40-6b3a-4d7e-8a51-2f0c9d4b7e13")
        #expect(version == 13)
        #expect(StubURLProtocol.lastRequest?.httpMethod == "DELETE")
    }

    @Test func statusesMapToTheTypedErrors() async throws {
        let record = try JSONDecoder.syncApi.decode(SyncCollection.self, from: try CollectionFixtureTests.data("valid.json"))
        let api = collectionsApi()
        func put(_ status: Int, _ body: String) async -> SyncApiError? {
            StubURLProtocol.handler = { _ in (status, [:], Data(body.utf8)) }
            do { _ = try await api.putCollection(record); return nil } catch { return error as? SyncApiError }
        }
        #expect(await put(404, "{}") == .notFound)
        #expect(await put(429, "{}") == .rateLimited)
        #expect(await put(409, "{\"error\":\"too_many_collections\"}") == .tooManyCollections)
        #expect(await put(409, "{\"error\":\"conflict\"}") == .conflict(serverUpdatedAt: nil))
        StubURLProtocol.handler = { _ in (404, [:], Data("{}".utf8)) }
        await #expect(throws: SyncApiError.notFound) { _ = try await api.collections(sinceVersion: 0, limit: 200) }
    }
}

extension StubURLProtocol {
    /// A request's body, from `httpBody` or (as `URLSession` hands it to a protocol) its stream.
    static func bodyData(of request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
