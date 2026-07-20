// チャット画面（Phase 4：本実装）
// ・rooms/{roomId}/messages にメッセージを追加して送信
// ・onSnapshot で時刻順にリアルタイム受信・表示（過去のやり取り＝そのまま履歴）
// ・マッチング成立（部屋作成）から5分間だけ会話でき、時間切れで終了する

import { useHeaderHeight } from '@react-navigation/elements';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../firebase';
import { useAuth } from '../../lib/auth-context';
import { useBackgroundColor } from '../../lib/background-color-context';

// 会話できる時間（5分）。
const CHAT_DURATION_MS = 5 * 60 * 1000;

// 1件のメッセージの型。並び順はサーバー時刻（createdAt）で決めるので画面では持たない。
type Message = {
  id: string;
  senderId: string;
  text: string;
};

export default function ChatRoomScreen() {
  // URL から部屋ID（/chat/xxxx の xxxx 部分）を受け取る。
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { user } = useAuth();
  const { backgroundColor } = useBackgroundColor();
  const router = useRouter();
  const headerHeight = useHeaderHeight();

  const [partnerName, setPartnerName] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);

  // 残り時間（ミリ秒）と、終了したかどうか。
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);

  // 今回の会話の開始時刻（5分カウントダウンの基準。サーバー時刻のミリ秒）。
  // 同じ相手と再マッチした場合は、その都度この時刻が更新される。
  const sessionStartRef = useRef<number | null>(null);
  // この端末の時計とサーバー時計のズレ（ミリ秒）。Date.now() に足すとサーバー時刻になる。
  const offsetRef = useRef(0);
  // ステータスを二重に戻さないための目印。
  const statusResetRef = useRef(false);
  const listRef = useRef<FlatList<Message>>(null);

  // 自分のステータスを online に戻す（次のマッチングに備える）。1回だけ実行。
  const resetStatusToOnline = useCallback(async () => {
    if (!user || statusResetRef.current) return;
    statusResetRef.current = true;
    await updateDoc(doc(db, 'users', user.uid), {
      status: 'online',
      currentRoomId: '',
    }).catch(() => { });
  }, [user]);

  // 部屋情報の読み込み＋メッセージのリアルタイム購読。
  useEffect(() => {
    if (!roomId || !user) return;

    (async () => {
      const roomRef = doc(db, 'rooms', roomId);
      try {
        // サーバー時刻との「時差」を測る。
        // 自分専用の欄にサーバー時刻を書き込み、サーバーから読み直して Date.now() と比べる。
        // これで端末の時計がズレていても、残り時間を両端末でほぼ一致させられる。
        const probeField = `clock_${user.uid}`;
        await updateDoc(roomRef, { [probeField]: serverTimestamp() });
        const fresh = await getDocFromServer(roomRef);

        const serverNow = fresh.get(probeField);
        if (serverNow && typeof serverNow.toMillis === 'function') {
          offsetRef.current = serverNow.toMillis() - Date.now();
        }

        // 今回の会話開始時刻（サーバー時刻のミリ秒）。
        // sessionStartedAt が基本。無ければ古い形式の createdAt にフォールバック。
        const sessionStart = fresh.get('sessionStartedAt') ?? fresh.get('createdAt');
        sessionStartRef.current =
          sessionStart && typeof sessionStart.toMillis === 'function'
            ? sessionStart.toMillis()
            : typeof sessionStart === 'number'
              ? sessionStart
              : Date.now();

        // 相手のニックネーム。
        const participants: string[] = fresh.get('participants') ?? [];
        const partnerId = participants.find((id) => id !== user.uid);
        if (partnerId) {
          const partnerSnap = await getDoc(doc(db, 'users', partnerId));
          if (partnerSnap.exists()) setPartnerName(partnerSnap.data().nickname ?? '相手');
        }
      } catch (e) {
        console.warn('部屋情報の取得に失敗', e);
        sessionStartRef.current = Date.now();
      }
      setLoading(false);
    })();

    // メッセージをサーバー時刻順（古い→新しい）でリアルタイム購読。
    // serverTimestamps:'estimate' を使うと、送信直後（サーバー確定前）のメッセージも
    // 推定時刻で正しい位置に並ぶので、表示が変に前後しない。
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
  }, [roomId, user]);

  // 1秒ごとに残り時間を計算し、0になったら終了する。
  useEffect(() => {
    if (sessionStartRef.current === null) return;
    const tick = () => {
      // 「今のサーバー時刻」= 端末時刻 + 時差。これで両端末の残り時間がほぼ揃う。
      const serverNow = Date.now() + offsetRef.current;
      const remaining = sessionStartRef.current! + CHAT_DURATION_MS - serverNow;
      if (remaining <= 0) {
        setRemainingMs(0);
        setEnded(true);
        resetStatusToOnline(); // 時間切れ → 自分を online に戻す
      } else {
        setRemainingMs(remaining);
      }
    };
    tick(); // すぐ1回計算
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [loading, resetStatusToOnline]);

  // 画面を離れるときは必ずステータスを online に戻す。
  useEffect(() => {
    return () => {
      resetStatusToOnline();
    };
  }, [resetStatusToOnline]);

  // メッセージ送信。
  const handleSend = async () => {
    const text = input.trim();
    if (!text || !user || !roomId || ended) return;
    setInput(''); // 先に入力欄をクリアして体感を良くする
    try {
      await addDoc(collection(db, 'rooms', roomId, 'messages'), {
        senderId: user.uid,
        text,
        createdAt: serverTimestamp(), // サーバー時刻で記録 → 全員で同じ並び順になる
      });
      // 履歴一覧の「最新メッセージ」と並び替え用の時刻を更新する。
      await updateDoc(doc(db, 'rooms', roomId), {
        lastMessage: text,
        lastActivityAt: serverTimestamp(),
      }).catch(() => { });
    } catch {
      // 送信失敗時は入力を戻す。
      setInput(text);
    }
  };

  // ホームに戻る。
  const handleLeave = async () => {
    await resetStatusToOnline();
    router.back();
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor }]}>
        <Stack.Screen options={{ title: 'チャット' }} />
        <ActivityIndicator size="large" color="#1D3D47" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['bottom']}>
      {/* ヘッダーのタイトルを相手の名前にする */}
      <Stack.Screen options={{ title: partnerName || 'チャット',
      // iOS の戻るボタンのタイトルを「戻る」に修正した
      headerBackTitle: '戻る',
      }} />

      {/* 残り時間バー（1分を切ったら赤色） */}
      <View style={styles.timerBar}>
        <Text style={[styles.timerText, isUnderOneMinute(remainingMs) && styles.timerTextWarn]}>
          残り {formatRemaining(remainingMs)}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}>
        {/* メッセージ一覧 */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <Text style={styles.emptyText}>メッセージを送ってあいさつしてみよう！</Text>
          }
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

        {/* 入力欄 or 終了表示 */}
        {ended ? (
          <View style={styles.endedBox}>
            <Text style={styles.endedText}>チャットが終了しました（5分経過）</Text>
            <TouchableOpacity style={styles.endedButton} onPress={handleLeave}>
              <Text style={styles.endedButtonText}>ホームに戻る</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="メッセージを入力"
              multiline
            />
            <TouchableOpacity
              style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!input.trim()}>
              <Text style={styles.sendButtonText}>送信</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// 残りミリ秒を "m:ss" 形式にする。
function formatRemaining(ms: number | null): string {
  if (ms === null) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// 残り1分未満か（警告色にするため）。
function isUnderOneMinute(ms: number | null): boolean {
  return ms !== null && ms <= 60 * 1000;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  timerBar: {
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#eef2f3',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e4e6',
  },
  timerText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1D3D47',
  },
  timerTextWarn: {
    color: '#B00020',
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  input: {
    flex: 1,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    marginRight: 8,
  },
  sendButton: {
    backgroundColor: '#1D3D47',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  endedBox: {
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  endedText: {
    fontSize: 15,
    color: '#555',
    marginBottom: 12,
  },
  endedButton: {
    backgroundColor: '#1D3D47',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  endedButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
