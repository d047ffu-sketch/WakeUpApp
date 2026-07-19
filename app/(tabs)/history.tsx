// トーク履歴の一覧画面
// 今までにチャットした相手を「最後に会話した順（新しいものが上）」で並べる。
// タップすると、その相手との過去のトーク内容を閲覧できる。

import { useRouter } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../firebase';
import { useAuth } from '../../lib/auth-context';

// 一覧に出す1件分のデータ。
type HistoryItem = {
  roomId: string;
  partnerName: string;
  lastMessage: string;
  lastActivityMs: number; // 並び替え用（最後に会話した時刻）
};

export default function HistoryScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  // 取得済みのニックネームを覚えておき、同じ人を何度も読みに行かないようにする。
  const nameCacheRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    // 自分が参加している部屋をすべて購読する（array-contains は単一フィールドなので索引不要）。
    const roomsQuery = query(
      collection(db, 'rooms'),
      where('participants', 'array-contains', user.uid),
    );
    const unsubscribe = onSnapshot(roomsQuery, async (snap) => {
      // 相手ごとにまとめる。同じ人の部屋が複数あっても、一番新しく会話した1件だけ残す。
      const byPartner = new Map<
        string,
        { roomId: string; lastMessage: string; lastActivityMs: number }
      >();
      snap.docs.forEach((d) => {
        // 確定前のサーバー時刻も推定値で扱い、並び順を安定させる。
        const data = d.data({ serverTimestamps: 'estimate' });
        const participants: string[] = data.participants ?? [];
        const partnerId = participants.find((id) => id !== user.uid);
        if (!partnerId) return;
        const lastActivity = data.lastActivityAt;
        const lastActivityMs =
          lastActivity && typeof lastActivity.toMillis === 'function'
            ? lastActivity.toMillis()
            : 0;
        const existing = byPartner.get(partnerId);
        if (!existing || lastActivityMs > existing.lastActivityMs) {
          byPartner.set(partnerId, {
            roomId: d.id,
            lastMessage: data.lastMessage || '（メッセージなし）',
            lastActivityMs,
          });
        }
      });

      // 相手のニックネームを取得（未取得の人だけ読みに行く）。
      const partnerIds = Array.from(byPartner.keys());
      await Promise.all(
        partnerIds.map(async (pid) => {
          if (nameCacheRef.current[pid] === undefined) {
            const snapUser = await getDoc(doc(db, 'users', pid));
            nameCacheRef.current[pid] = snapUser.exists()
              ? (snapUser.data().nickname ?? '相手')
              : '相手';
          }
        }),
      );

      // 最後に会話した時刻が新しい順に並べて表示用リストにする。
      const list: HistoryItem[] = partnerIds
        .map((pid) => {
          const room = byPartner.get(pid)!;
          return {
            roomId: room.roomId,
            partnerName: nameCacheRef.current[pid] || '相手',
            lastMessage: room.lastMessage,
            lastActivityMs: room.lastActivityMs,
          };
        })
        .sort((a, b) => b.lastActivityMs - a.lastActivityMs);
      setItems(list);
    });

    return () => unsubscribe();
  }, [user]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>トーク履歴</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.roomId}
        contentContainerStyle={items.length === 0 && styles.emptyWrap}
        ListEmptyComponent={
          <Text style={styles.emptyText}>まだトーク履歴がありません。{'\n'}マッチングして話してみよう！</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() =>
              router.push({ pathname: '/history/[roomId]', params: { roomId: item.roomId } })
            }>
            {/* 相手の頭文字を丸アイコン風に表示 */}
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.partnerName.charAt(0) || '?'}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.partnerName}>{item.partnerName}</Text>
              <Text style={styles.lastMessage} numberOfLines={1}>
                {item.lastMessage}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1D3D47',
  },
  emptyWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1D3D47',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  rowBody: {
    flex: 1,
  },
  partnerName: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#222',
    marginBottom: 2,
  },
  lastMessage: {
    fontSize: 14,
    color: '#888',
  },
});
