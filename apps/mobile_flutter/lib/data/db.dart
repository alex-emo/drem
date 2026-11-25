/// SQLite 打开与建表：库 `dream_flutter` v1，字段对齐 chat.md。
library;

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

const String _dbName = 'dream_flutter.db';

/// 打开（不存在则建）本地库：优先 [getDatabasesPath]，空时回退文档目录。
Future<Database> openDreamDatabase() async {
  var dir = await getDatabasesPath();
  if (dir.isEmpty) {
    dir = (await getApplicationDocumentsDirectory()).path;
  }
  final path = p.join(dir, _dbName);
  return openDatabase(path, version: 1, onCreate: _onCreate);
}

Future<void> _onCreate(Database db, int version) async {
  await db.execute('''
    CREATE TABLE conversations(
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      rootMessageId TEXT,
      encTitle TEXT
    )
  ''');
  await db.execute('''
    CREATE TABLE messages(
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      reasoning TEXT,
      status TEXT NOT NULL,
      excludeFromContext INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      errorCode TEXT,
      errorRequestId TEXT,
      webSearch INTEGER NOT NULL DEFAULT 0,
      files TEXT,
      sources TEXT,
      createdAt INTEGER NOT NULL,
      parentId TEXT,
      selectedChildId TEXT,
      enc TEXT,
      encReasoning TEXT
    )
  ''');
  await db.execute('''
    CREATE TABLE tombstones(
      id TEXT PRIMARY KEY,
      deletedAt INTEGER NOT NULL
    )
  ''');
  await db.execute(
    'CREATE INDEX idx_messages_conv_created ON messages(conversationId, createdAt)',
  );
  await db.execute(
    'CREATE INDEX idx_conversations_updated ON conversations(updatedAt)',
  );
}
