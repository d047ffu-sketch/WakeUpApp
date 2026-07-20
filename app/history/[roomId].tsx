// トーク履歴の詳細画面（読み取り専用）
// 履歴一覧から開く。過去のメッセージを時刻順に表示するだけで、送信や5分タイマーは無い。
// （リアルタイムの会話は chat/[roomId] 側で行う）

import { Stack, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../firebase';
import { useAuth } from '../../lib/auth-context';
import { useBackgroundColor } from '../../lib/background-color-context';

type Message = {
  id: string;
  senderId: string;
  text: string;
};

export default function HistoryDetailScreen() {
  const { backgroundColor } = useBackgroundColor();
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { user } = useAuth();
  const [partnerName, setPartnerName] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const listRef = useRef<FlatList<Message>>(null);

  // 相手のニックネームを、相手のユーザー情報から直接取得する（古い部屋でも表示できる）。
  useEffect(() => {
    if (!roomId || !user) return;
    (async () => {
      const roomSnap = await getDoc(doc(db, 'rooms', roomId));
      if (roomSnap.exists()) {
        const participants: string[] = roomSnap.data().participants ?? [];
        const partnerId = participants.find((id) => id !== user.uid);
        if (partnerId) {
          const partnerSnap = await getDoc(doc(db, 'users', partnerId));
          if (partnerSnap.exists()) setPartnerName(partnerSnap.data().nickname ?? '相手');
        }
      }
    })();
  }, [roomId, user]);

  // メッセージを時刻順に購読（履歴なので最新を見るだけ）。
  useEffect(() => {
    if (!roomId) return;
    const messagesQuery = query(
      collection(db, 'rooms', roomId, 'messages'),
      orderBy('createdAt'),
    );
    const unsubscribe = onSnapshot(messagesQuery, (snap) => {
      const list: Message[] = snap.docs.map((d) => {
        const data = d.data({ serverTimestamps: 'estimate' });
        return { id: d.id, senderId: data.senderId, text: data.text };
      });
      setMessages(list);
    });
    return () => unsubscribe();
  }, [roomId]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
      {/* ヘッダーのタイトルを相手の名前にする */}
      <Stack.Screen options={{
        title: partnerName || 'トーク履歴',
        // iOS の戻るボタンのタイトルを「戻る」に修正した
        headerBackTitle: '戻る',
      }} />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<Text style={styles.emptyText}>メッセージはまだありません。</Text>}
        renderItem={({ item }) => {
          const isMine = item.senderId === user?.uid;
          return (
            <View style={[styles.bubbleRow, isMine ? styles.rowRight : styles.rowLeft]}>
              <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
                <Text style={isMine ? styles.bubbleTextMine : styles.bubbleTextOther}>
                  {item.text}
                </Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  listContent: {
    padding: 12,
    flexGrow: 1,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 40,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  rowRight: {
    justifyContent: 'flex-end',
  },
  rowLeft: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMine: {
    backgroundColor: '#1D3D47',
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: '#e9e9eb',
    borderBottomLeftRadius: 4,
  },
  bubbleTextMine: {
    color: '#fff',
    fontSize: 16,
  },
  bubbleTextOther: {
    color: '#000',
    fontSize: 16,
  },
});
