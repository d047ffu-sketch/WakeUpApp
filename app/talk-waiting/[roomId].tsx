// トーク待機画面
// アラームを止めた人がここに来る。相手が起きるのを待ち、まだなら「起きて！」を送れる。
// 2人とも起きたら（部屋の sessionStartedAt がセットされたら）トークルームへ移動する。

import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../firebase';
import { useAuth } from '../../lib/auth-context';
import { cancelMatch, sendWakePing } from '../../lib/matching';

export default function TalkWaitingScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [partnerId, setPartnerId] = useState('');
  const [partnerName, setPartnerName] = useState('相手');
  const [partnerAwake, setPartnerAwake] = useState(false);
  const navigatedRef = useRef(false); // 二重遷移を防ぐ

  // 部屋をリアルタイム監視。
  useEffect(() => {
    if (!roomId || !user) return;
    const unsubscribe = onSnapshot(doc(db, 'rooms', roomId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();

      // 相手のIDと名前。
      const participants: string[] = data.participants ?? [];
      const pid = participants.find((id) => id !== user.uid) ?? '';
      setPartnerId(pid);
      const names = data.names ?? {};
      setPartnerName(names[pid] || '相手');

      // 相手が起きたか。
      const awake = data.awake ?? {};
      setPartnerAwake(!!awake[pid]);

      // 2人とも起きた（sessionStartedAt がセットされた）→ トークルームへ。
      if (data.sessionStartedAt && !navigatedRef.current) {
        navigatedRef.current = true;
        router.replace({ pathname: '/chat/[roomId]', params: { roomId } });
      }
    });
    return () => unsubscribe();
  }, [roomId, user, router]);

  // 「起きて！」を送る。
  const handleWake = async () => {
    if (!roomId || !partnerId) return;
    await sendWakePing(roomId, partnerId);
    Alert.alert(
      '「起きて！」を送りました',
      `${partnerName} さんの端末に通知が届きます。\n（相手がアプリを開いている場合）`,
    );
  };

  // キャンセル（マッチをやめてホームに戻る）。二重遷移防止のためフラグを立てる。
  const handleCancel = async () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    if (user && roomId) await cancelMatch(user.uid, roomId);
    router.back(); // ホーム（トーク待機を開いた元の画面）へ戻る
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.title}>相手を待っています…</Text>
        <Text style={styles.partner}>お相手：{partnerName} さん</Text>

        {partnerAwake ? (
          <Text style={styles.statusOk}>相手も起きました！まもなくトークが始まります</Text>
        ) : (
          <>
            <Text style={styles.statusWait}>{partnerName} さんはまだ起きていません</Text>
            <TouchableOpacity style={styles.wakeButton} onPress={handleWake}>
              <Text style={styles.wakeButtonText}>起きて！</Text>
            </TouchableOpacity>
          </>
        )}

        {/* キャンセル（マッチをやめてホームに戻る） */}
        <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
          <Text style={styles.cancelButtonText}>キャンセル</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1D3D47',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 20,
    marginBottom: 8,
  },
  partner: {
    fontSize: 16,
    color: '#cfdde2',
    marginBottom: 40,
  },
  statusWait: {
    fontSize: 15,
    color: '#ffd7d7',
    marginBottom: 20,
  },
  statusOk: {
    fontSize: 16,
    color: '#c8f7c5',
    textAlign: 'center',
  },
  wakeButton: {
    backgroundColor: '#ff5a5a',
    borderRadius: 40,
    paddingVertical: 22,
    paddingHorizontal: 60,
  },
  wakeButtonText: {
    color: '#fff',
    fontSize: 26,
    fontWeight: 'bold',
  },
  cancelButton: {
    marginTop: 48,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#cfdde2',
  },
  cancelButtonText: {
    color: '#cfdde2',
    fontSize: 15,
    fontWeight: '600',
  },
});
