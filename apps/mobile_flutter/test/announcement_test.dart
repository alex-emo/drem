import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:dream/services/api_client.dart';

void main() {
  test('getAnnouncement 解析服务端公告', () async {
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/api/v1/announcement');
      return http.Response(
        jsonEncode({
          'announcement': {
            'id': 'a1',
            'title': '维护通知',
            'body': '今晚 23:00 维护',
            'updatedAt': '2026-11-25T00:00:00Z',
          },
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = ApiClient(
      baseUrl: 'https://example.test',
      tokenProvider: () => '',
      client: client,
    );

    final notice = await api.getAnnouncement();
    expect(notice?.id, 'a1');
    expect(notice?.title, '维护通知');
    expect(notice?.body, contains('维护'));
  });

  test('无公告时返回 null', () async {
    final api = ApiClient(
      baseUrl: 'https://example.test',
      tokenProvider: () => '',
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({'announcement': null}),
          200,
          headers: {'content-type': 'application/json'},
        ),
      ),
    );

    expect(await api.getAnnouncement(), isNull);
  });
}
